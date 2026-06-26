// Pipeline Orchestrator — SUST spec aligned.
// Wires M1 → M2 → M3 → M5 → M6 → M4 → M7 → M8 → M9 → M10 → M11 → M12 (output) → M13
// Assembles the final TicketResponse with spec field names: agent_summary, recommended_next_action.

import type { TicketRequest, TicketResponse, PipelineContext, Language, Transaction } from '../schemas.js';
import { validateRequest } from './request_validator.js';
import { normalizeComplaint } from './complaint_normalizer.js';
import { extractFacts } from './fact_extractor.js';
import { runRuleEngine } from './rule_engine.js';
import { matchEvidence } from './evidence_matcher.js';
import { reasonEvidence } from './evidence_reasoner.js';
import { classifyCase } from './classifier.js';
import { routeDepartment } from './department_router.js';
import { calculateSeverity } from './severity_engine.js';
import { decideReview } from './review_engine.js';
import { generateReplies, getSafeFallbackReply } from './template_engine.js';
import { scanInput, scanOutput } from './safety_engine.js';
import { calculateConfidence } from './confidence.js';
import { validateOutput } from './output_validator.js';
import { logger } from '../logger.js';

export interface PipelineResult {
  success: true;
  response: TicketResponse;
  context: PipelineContext;
}

export interface PipelineError {
  success: false;
  status: number;
  body: { error: string; details?: string[] };
}

/**
 * Infer a human-readable label for what was being paid for in a payment_failed
 * complaint. Looks for specific recipient hints like "mobile recharge",
 * "electricity bill", etc. Falls back to "payment".
 */
function inferTxnLabel(complaint: string): string {
  const lower = complaint.toLowerCase();
  if (/recharge|top\s*up|topup|রিচার্জ/.test(lower)) return 'mobile recharge';
  if (/electric|বিদ্যুৎ|desco/.test(lower)) return 'electricity bill payment';
  if (/gas|গ্যাস/.test(lower)) return 'gas bill payment';
  if (/water|পানি|wasa/.test(lower)) return 'water bill payment';
  if (/internet|wifi|broadband/.test(lower)) return 'internet bill payment';
  if (/tuition|education|school|college/.test(lower)) return 'education payment';
  if (/merchant|shop|store|dokan|বিক্রেতা/.test(lower)) return 'merchant payment';
  if (/\bbill\b|বিল/.test(lower)) return 'bill payment';
  return 'payment';
}

/**
 * Find the duplicate partner of a given transaction (same amount + counterparty,
 * within 60 seconds). Returns the earlier one + the time delta in seconds, or
 * null if none.
 */
function findDuplicatePartner(
  transactions: Transaction[],
  matchedId: string | null
): { partnerTxnId: string; timeDeltaSeconds: number } | null {
  if (!matchedId) return null;
  const matched = transactions.find((t) => t.transaction_id === matchedId);
  if (!matched) return null;
  const matchedTime = new Date(matched.timestamp).getTime();
  for (const t of transactions) {
    if (t.transaction_id === matchedId) continue;
    if (t.amount !== matched.amount) continue;
    if ((t.counterparty || '') !== (matched.counterparty || '')) continue;
    const dt = Math.abs(new Date(t.timestamp).getTime() - matchedTime);
    if (dt <= 60_000) {
      return { partnerTxnId: t.transaction_id, timeDeltaSeconds: Math.round(dt / 1000) };
    }
  }
  return null;
}

/**
 * Build semantic, spec-style reason codes for the response.
 * These are short snake_case tags rather than human-readable sentences.
 */
function buildReasonCodes(
  caseType: string,
  evidenceVerdict: string,
  safetyFlags: string[],
  hasMerchantFlag: boolean,
  hasAgentFlag: boolean,
  fraud: boolean,
  deductionSignal: boolean
): string[] {
  const codes: string[] = [];

  // Base case-type tag
  if (caseType === 'wrong_transfer') {
    if (evidenceVerdict === 'insufficient_data') {
      // SAMPLE-08: ambiguous_match + needs_clarification only (no wrong_transfer_claim).
      codes.push('ambiguous_match');
      codes.push('needs_clarification');
    } else if (evidenceVerdict === 'inconsistent') {
      codes.push('wrong_transfer_claim');
      codes.push('established_recipient_pattern');
      codes.push('evidence_inconsistent');
    } else {
      codes.push('wrong_transfer');
      codes.push('transaction_match');
      codes.push('dispute_initiated');
    }
  } else if (caseType === 'payment_failed') {
    codes.push('payment_failed');
    // SAMPLE-03: a payment_failed with a "balance deducted" complaint always
    // surfaces potential_balance_deduction, regardless of the fraud flag.
    if (deductionSignal || fraud) codes.push('potential_balance_deduction');
  } else if (caseType === 'refund_request') {
    codes.push('refund_request');
    codes.push('merchant_policy_dependent');
  } else if (caseType === 'phishing_or_social_engineering') {
    codes.push('phishing');
    codes.push('credential_protection');
    codes.push('critical_escalation');
  } else if (caseType === 'duplicate_payment') {
    codes.push('duplicate_payment');
    codes.push('biller_verification_required');
  } else if (caseType === 'merchant_settlement_delay') {
    codes.push('merchant_settlement');
    codes.push('delay');
    codes.push('pending');
  } else if (caseType === 'agent_cash_in_issue') {
    codes.push('agent_cash_in');
    codes.push('pending_transaction');
    codes.push('agent_ops');
  } else if (caseType === 'other') {
    if (evidenceVerdict === 'insufficient_data') {
      codes.push('vague_complaint');
      codes.push('needs_clarification');
    } else {
      codes.push('other');
    }
  }

  // Safety flags
  for (const flag of safetyFlags) {
    if (flag === 'credential_request') codes.push('credential_protection');
    if (flag === 'injection') codes.push('prompt_injection');
  }

  // Merchant dispute tag (only for wrong_transfer)
  if (hasMerchantFlag && caseType === 'wrong_transfer') codes.push('merchant_dispute');
  // Note: agent_operations tag is intentionally NOT added here — the
  // agent_cash_in_issue caseType branch already adds agent_ops, and we don't
  // want it bleeding into unrelated cases (matches SAMPLE-07 spec).

  // Deduplicate while preserving order
  return [...new Set(codes)];
}

/**
 * Heuristic: does the complaint mention that balance was deducted?
 */
function hasDeductionSignal(complaint: string, tokens: string[]): boolean {
  const lower = complaint.toLowerCase();
  if (/\b(?:balance\s*(?:was\s*)?deduct(?:ed)?|amount\s*(?:was\s*)?deduct(?:ed)?|deduct(?:ed)?\s*(?:from\s*)?(?:my\s*)?(?:account|balance)|money\s*(?:was\s*)?(?:debited|taken))\b/.test(lower)) return true;
  if (tokens.some((t) => ['deducted', 'balance_deducted', 'amount_deducted', 'debited'].includes(t))) return true;
  return false;
}

/**
 * Run the full investigation pipeline M1–M13.
 */
export function runPipeline(rawBody: unknown): PipelineResult | PipelineError {
  const startTime = Date.now();

  // ── M1: Request Validation ──────────────────────────────────────────────
  const validation = validateRequest(rawBody);
  if (!validation.valid || !validation.data) {
    return {
      success: false,
      status: validation.error!.status,
      body: validation.error!.body,
    };
  }

  const request = validation.data;
  const ticketId = request.ticket_id;

  // ── M12 Input Pass: Safety scan on raw complaint ────────────────────────
  const inputSafety = scanInput(request.complaint);
  const safetyFlags: string[] = [...inputSafety.flags];

  // ── M2: Complaint Normalization ─────────────────────────────────────────
  const { normalizedComplaint, tokens, detectedLanguage } = normalizeComplaint(request.complaint);

  // ── M3: Fact Extraction ─────────────────────────────────────────────────
  const { facts, factConfidence } = extractFacts(normalizedComplaint, tokens);

  // ── M5: Transaction Evidence Matching ───────────────────────────────────
  const { relevantTransactionId, evidenceScore, scoredTransactions } = matchEvidence(
    request.transaction_history,
    facts
  );

  // ── M6: Evidence Reasoning ──────────────────────────────────────────────
  const matchedTransaction: Transaction | null =
    relevantTransactionId
      ? request.transaction_history.find((t) => t.transaction_id === relevantTransactionId) ?? null
      : null;

  const { evidenceVerdict } = reasonEvidence(facts, matchedTransaction, evidenceScore, request.transaction_history);

  // ── M4: Rule Engine ─────────────────────────────────────────────────────
  const { candidate: ruleCandidate, ruleConfidence, matchedRule } = runRuleEngine(facts);

  // ── M7: Case Classification ─────────────────────────────────────────────
  const { caseType } = classifyCase(ruleCandidate, facts, safetyFlags);

  // ── Confidence Calculation ──────────────────────────────────────────────
  const confidence = calculateConfidence(
    evidenceScore,
    ruleConfidence,
    factConfidence,
    evidenceVerdict,
    relevantTransactionId === null,
    caseType
  );

  // ── M8: Department Routing ──────────────────────────────────────────────
  const hasMerchantFlag = facts.merchant !== null &&
    ['merchant', 'shop', 'store', 'dokan', 'বিক্রেতা', 'মার্চেন্ট', 'দোকান'].includes(facts.merchant);
  const hasAgentFlag = facts.merchant === 'agent' || facts.merchant === 'এজেন্ট';

  const { department } = routeDepartment(caseType, facts.amount, hasMerchantFlag, hasAgentFlag, confidence);

  // ── M9: Severity Scoring ────────────────────────────────────────────────
  const { severity } = calculateSeverity(
    caseType,
    facts.amount,
    evidenceVerdict,
    facts.fraud,
    hasMerchantFlag,
    hasAgentFlag
  );

  // ── M10: Human Review Decision ──────────────────────────────────────────
  const { humanReviewRequired, reviewReasons } = decideReview(
    caseType,
    severity,
    confidence,
    evidenceVerdict,
    facts.amount,
    hasMerchantFlag,
    hasAgentFlag,
    safetyFlags
  );

  // ── M11: Template Reply Generation ──────────────────────────────────────
  const language: Language = detectedLanguage;
  // Prefer the matched transaction's counterparty for template filling, so the
  // reply references the actual recipient rather than whatever the customer typed.
  const effectiveCounterparty =
    (matchedTransaction?.counterparty && matchedTransaction.counterparty.length > 0)
      ? matchedTransaction.counterparty
      : facts.counterparty;

  // Count prior transfers to the same counterparty (used by wrong_transfer_established template).
  let establishedPriorCount = 0;
  let establishedDays = 0;
  let establishedDisplayCount = 0;
  if (
    caseType === 'wrong_transfer' &&
    evidenceVerdict === 'inconsistent' &&
    matchedTransaction?.counterparty
  ) {
    const cp = matchedTransaction.counterparty;
    const matchedDate = new Date(matchedTransaction.timestamp).getTime();
    const priors = request.transaction_history.filter((t) =>
      t.transaction_id !== matchedTransaction.transaction_id &&
      (t.counterparty || '') === cp &&
      (t.status || '').toLowerCase() === 'completed' &&
      new Date(t.timestamp).getTime() < matchedDate
    );
    establishedPriorCount = priors.length;
    // Include the current matched transaction in the count (spec phrasing does this).
    // For the count WORD we want "three" (current + 2 priors) for SAMPLE-02.
    establishedDisplayCount = priors.length + 1;
    if (priors.length > 0) {
      const oldest = Math.min(...priors.map((t) => new Date(t.timestamp).getTime()));
      establishedDays = Math.max(1, Math.round((matchedDate - oldest) / (1000 * 60 * 60 * 24)));
    }
  }

  // Compute extras for richer templates.
  const txnLabel =
    caseType === 'payment_failed' || caseType === 'duplicate_payment'
      ? inferTxnLabel(request.complaint)
      : 'payment';
  let partnerTxnId: string | null = null;
  let timeDeltaSeconds: number | null = null;
  if (caseType === 'duplicate_payment') {
    const partner = findDuplicatePartner(request.transaction_history, relevantTransactionId);
    if (partner) {
      partnerTxnId = partner.partnerTxnId;
      timeDeltaSeconds = partner.timeDeltaSeconds;
    }
  }

  let { customerReply, agentSummary, recommendedNextAction } = generateReplies(
    caseType,
    department,
    severity,
    language,
    ticketId,
    request.customer_name,
    relevantTransactionId,
    evidenceVerdict,
    confidence,
    safetyFlags,
    facts.amount,
    effectiveCounterparty,
    establishedDisplayCount,
    establishedDays,
    { txnLabel, partnerTxnId, timeDeltaSeconds }
  );

  // ── M12 Output Pass: Scan generated replies for unsafe content ──────────
  const outputSafety = scanOutput(customerReply, agentSummary, recommendedNextAction);
  let finalHumanReview = humanReviewRequired;
  const allReasonCodes = [...reviewReasons];

  if (outputSafety.isUnsafe) {
    customerReply = getSafeFallbackReply(language, ticketId, request.customer_name);
    finalHumanReview = true;
    safetyFlags.push(...outputSafety.flags);
    allReasonCodes.push(`Output safety violation: ${outputSafety.flags.join(', ')}`);
    logger.warn({ ticketId, outputSafetyFlags: outputSafety.flags }, 'Output safety violation detected — swapped to safe template');
  }

  // ── Assemble Response ───────────────────────────────────────────────────
  // Build semantic reason codes (spec-style) by combining case_type with
  // the strongest evidence / safety signals.
  const deductionSignal = hasDeductionSignal(request.complaint, tokens);
  const reasonCodes = buildReasonCodes(
    caseType,
    evidenceVerdict,
    safetyFlags,
    hasMerchantFlag,
    hasAgentFlag,
    facts.fraud,
    deductionSignal
  );

  const rawResponse = {
    ticket_id: ticketId,
    case_type: caseType,
    department,
    severity,
    confidence: Math.round(confidence * 100) / 100,
    evidence_verdict: evidenceVerdict,
    relevant_transaction_id: relevantTransactionId,
    reason_codes: reasonCodes,
    human_review_required: finalHumanReview,
    customer_reply: customerReply,
    agent_summary: agentSummary,
    recommended_next_action: recommendedNextAction,
  };

  // ── M13: Output Validation ──────────────────────────────────────────────
  const outputValidation = validateOutput(rawResponse);
  if (!outputValidation.valid || !outputValidation.data) {
    logger.error({ ticketId, error: outputValidation.error }, 'Output validation failed');
    return {
      success: false,
      status: 500,
      body: { error: 'Internal processing error' },
    };
  }

  const latencyMs = Date.now() - startTime;
  logger.info({
    ticket_id: ticketId,
    latency_ms: latencyMs,
    case_type: caseType,
    severity,
    human_review_required: finalHumanReview,
    evidence_verdict: evidenceVerdict,
    confidence: rawResponse.confidence,
    matched_rule: matchedRule,
    llm_used: false,
  }, 'Pipeline completed');

  const context: PipelineContext = {
    request,
    normalizedComplaint,
    detectedLanguage,
    tokens,
    facts,
    factConfidence,
    ruleCandidate,
    ruleConfidence,
    relevantTransactionId,
    evidenceScore,
    scoredTransactions,
    evidenceVerdict,
    caseType,
    department,
    severity,
    humanReviewRequired: finalHumanReview,
    reviewReasons: allReasonCodes,
    customerReply,
    agentSummary,
    recommendedNextAction,
    confidence: rawResponse.confidence,
    safetyFlags,
    reasonCodes: allReasonCodes,
  };

  return {
    success: true,
    response: outputValidation.data,
    context,
  };
}

// M11 Template Reply Engine — SUST spec aligned.
// Bilingual safe templates with placeholders.
// No AI text generation — purely template-based.
// Never promises refund; routes to official channels only.

import type { CaseType, Department, Language, Severity } from '../schemas.js';
import { replyTemplates } from '../constants/index.js';

export interface TemplateResult {
  customerReply: string;
  agentSummary: string;
  recommendedNextAction: string;
}

function numberWord(n: number): string {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  return words[n] ?? n.toString();
}

/**
 * Fill placeholders. Word-suffixed placeholders are resolved first so they
 * don't get clobbered by the generic *_COUNT / *_DAYS loop below.
 */
function fillPlaceholders(template: string, vars: Record<string, string>): string {
  let result = template;
  result = result.replace(/\{ESTABLISHED_COUNT_WORD\}/g, numberWord(vars['ESTABLISHED_COUNT'] ? parseInt(vars['ESTABLISHED_COUNT'], 10) : 0));
  result = result.replace(/\{ESTABLISHED_DAYS_WORD\}/g, numberWord(vars['ESTABLISHED_DAYS'] ? parseInt(vars['ESTABLISHED_DAYS'], 10) : 0));
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Generate templated replies: customer reply, agent summary, recommended next action.
 *
 * Extended vars beyond the basic placeholders:
 *  - {TXN_LABEL}: e.g. "mobile recharge" — inferred from complaint text for
 *    payment_failed cases so the agent summary can describe what was being paid for.
 *  - {PARTNER_TXN_ID}, {TIME_DELTA_WORD}: the partner transaction id and
 *    human-readable time delta (e.g. "12 seconds") for duplicate_payment cases.
 */
export function generateReplies(
  caseType: CaseType,
  department: Department,
  severity: Severity,
  language: Language,
  ticketId: string,
  customerName: string,
  relevantTxnId: string | null,
  evidenceVerdict: string,
  confidence: number,
  safetyFlags: string[],
  amount: number | null,
  counterparty: string | null,
  establishedPriorCount: number = 0,
  establishedDays: number = 0,
  extras: {
    txnLabel?: string;
    partnerTxnId?: string | null;
    timeDeltaSeconds?: number | null;
  } = {}
): TemplateResult {
  let timeDeltaWord = 'moments';
  if (extras.timeDeltaSeconds !== null && extras.timeDeltaSeconds !== undefined) {
    const s = extras.timeDeltaSeconds;
    if (s < 60) timeDeltaWord = `${s} second${s === 1 ? '' : 's'}`;
    else if (s < 3600) {
      const m = Math.round(s / 60);
      timeDeltaWord = `${m} minute${m === 1 ? '' : 's'}`;
    } else if (s < 86400) {
      const h = Math.round(s / 3600);
      timeDeltaWord = `${h} hour${h === 1 ? '' : 's'}`;
    } else {
      const d = Math.round(s / 86400);
      timeDeltaWord = `${d} day${d === 1 ? '' : 's'}`;
    }
  }

  const vars: Record<string, string> = {
    TICKET_ID: ticketId,
    CUSTOMER_NAME: customerName || 'Valued Customer',
    DEPARTMENT: department.replace(/_/g, ' '),
    TXN_ID: relevantTxnId || 'N/A',
    AMOUNT: amount !== null ? amount.toString() : 'N/A',
    COUNTERPARTY: counterparty || 'N/A',
    CASE_TYPE: caseType.replace(/_/g, ' '),
    EVIDENCE_VERDICT: evidenceVerdict,
    CONFIDENCE: (confidence * 100).toFixed(0) + '%',
    SEVERITY: severity,
    SAFETY_FLAGS: safetyFlags.join(', ') || 'none',
    ESTABLISHED_COUNT: establishedPriorCount > 0 ? establishedPriorCount.toString() : 'multiple',
    ESTABLISHED_DAYS: establishedDays > 0 ? establishedDays.toString() : 'several',
    TXN_LABEL: extras.txnLabel || 'payment',
    PARTNER_TXN_ID: extras.partnerTxnId || 'N/A',
    TIME_DELTA_WORD: timeDeltaWord,
  };

  // Sub-case key: ambiguous wrong-transfer (SAMPLE-08) and established-recipient
  // (SAMPLE-02) each get their own template.
  let templateKey: string = caseType;
  if (caseType === 'wrong_transfer' && evidenceVerdict === 'insufficient_data') {
    templateKey = 'wrong_transfer_ambiguous';
  } else if (caseType === 'wrong_transfer' && evidenceVerdict === 'inconsistent') {
    templateKey = 'wrong_transfer_established';
  }

  // Select customer reply template
  const lang: 'en' | 'bn' = language === 'bn' ? 'bn' : 'en';
  const customerTemplate =
    replyTemplates.customer_reply[lang]?.[templateKey] ||
    replyTemplates.customer_reply.en[templateKey] ||
    replyTemplates.customer_reply[lang]?.[caseType] ||
    replyTemplates.customer_reply.en[caseType] ||
    replyTemplates.safe_fallback[lang] ||
    replyTemplates.safe_fallback.en;

  const customerReply = fillPlaceholders(customerTemplate, vars);

  // Select agent summary template.
  // Priority (highest first):
  //   1. Safety flag → safety_flagged template
  //   2. templateKey-specific override when it differs from caseType
  //      (e.g. wrong_transfer_established, wrong_transfer_ambiguous)
  //   3. caseType-specific template (phishing / other / agent_cash_in_issue / etc.)
  //   4. insufficient_data fallback (only used when no caseType template exists)
  //   5. hardcoded fallback
  let summaryTemplate: string;
  if (safetyFlags.length > 0) {
    summaryTemplate = replyTemplates.agent_summary.safety_flagged;
  } else if (
    templateKey !== caseType &&
    replyTemplates.agent_summary[templateKey]
  ) {
    summaryTemplate = replyTemplates.agent_summary[templateKey];
  } else if (replyTemplates.agent_summary[caseType]) {
    summaryTemplate = replyTemplates.agent_summary[caseType];
  } else if (evidenceVerdict === 'insufficient_data' && replyTemplates.agent_summary.insufficient_data) {
    summaryTemplate = replyTemplates.agent_summary.insufficient_data;
  } else {
    summaryTemplate = `Case ${ticketId} classified as ${caseType}.`;
  }
  const agentSummary = fillPlaceholders(summaryTemplate, vars);

  // Recommended next action
  const actionTemplate =
    replyTemplates.recommended_next_action[templateKey] ||
    replyTemplates.recommended_next_action[caseType] ||
    replyTemplates.recommended_next_action.default;
  const recommendedNextAction = fillPlaceholders(actionTemplate, vars);

  return { customerReply, agentSummary, recommendedNextAction };
}

/**
 * Get the safe fallback template for when output safety violations are detected.
 */
export function getSafeFallbackReply(language: Language, ticketId: string, customerName: string): string {
  const lang: 'en' | 'bn' = language === 'bn' ? 'bn' : 'en';
  const template = replyTemplates.safe_fallback[lang] || replyTemplates.safe_fallback.en;
  return fillPlaceholders(template, {
    TICKET_ID: ticketId,
    CUSTOMER_NAME: customerName || 'Valued Customer',
  });
}
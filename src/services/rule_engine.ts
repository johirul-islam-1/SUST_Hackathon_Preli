// M4 Rule Engine — aligned to SUST spec enums.
// Ordered rule set: fact-pattern → case_type candidate.
// Deterministic and debuggable.

import type { ExtractedFacts, CaseType } from '../schemas.js';
import { CASE_TYPES } from '../schemas.js';

export interface RuleEngineResult {
  candidate: CaseType;
  ruleConfidence: number;
  matchedRule: string;
}

interface Rule {
  name: string;
  condition: (facts: ExtractedFacts) => boolean;
  caseType: CaseType;
  confidence: number;
}

/**
 * Ordered rule set. First matching rule wins.
 * Rules are ordered by specificity — most specific first.
 */
const RULES: Rule[] = [
  // Phishing / social engineering — highest priority safety rule
  {
    name: 'phishing_fraud_signal',
    condition: (f) => f.fraud && f.keywords.some((k) =>
      ['pin_shared', 'otp_shared', 'pin_asked', 'otp_asked', 'phishing', 'tricked', 'deceived', 'fake'].includes(k)
    ),
    caseType: 'phishing_or_social_engineering',
    confidence: 0.95,
  },
  {
    name: 'phishing_keywords',
    condition: (f) => f.keywords.some((k) =>
      ['phishing', 'pin_shared', 'otp_shared', 'pin_asked', 'otp_asked', 'fake'].includes(k)
    ),
    caseType: 'phishing_or_social_engineering',
    confidence: 0.95,
  },

  // Wrong transfer — includes "brother/sister says they didn't get it"
  // Skip if the fact extractor already classified the issue as something else
  // (e.g. "other" for a vague complaint containing the word "wrong").
  {
    name: 'wrong_transfer_keywords',
    condition: (f) => {
      if (f.issue && f.issue !== 'wrong_transfer') return false;
      return (
        f.keywords.some((k) => ['wrong_transfer', 'wrong', 'mistake', 'accidental', 'vul', 'vule'].includes(k)) ||
        f.keywords.includes("brother") ||
        f.keywords.includes("sister") ||
        f.keywords.includes("friend")
      );
    },
    caseType: 'wrong_transfer',
    confidence: 0.85,
  },

  // Duplicate payment — two identical payments
  {
    name: 'duplicate_payment_keywords',
    condition: (f) =>
      f.keywords.some((k) => ['duplicate', 'twice', 'double', 'ডুপ্লিকেট', 'দুইবার', 'duibar'].includes(k)) ||
      f.keywords.includes('charged') && f.keywords.includes('twice') ||
      f.keywords.includes('deducted') && f.keywords.includes('twice'),
    caseType: 'duplicate_payment',
    confidence: 0.9,
  },

  // Agent cash-in issue
  {
    name: 'agent_cash_in_keywords',
    condition: (f) =>
      (f.keywords.includes('agent') || f.merchant === 'agent' || f.merchant === 'এজেন্ট') &&
      (f.keywords.includes('cashin') || f.keywords.includes('cash') || f.keywords.includes('in') || f.txnType === 'cash_in'),
    caseType: 'agent_cash_in_issue',
    confidence: 0.88,
  },

  // Merchant settlement delay
  {
    name: 'merchant_settlement_keywords',
    condition: (f) =>
      f.keywords.includes('settlement') || f.keywords.includes('settle') ||
      (f.merchant !== null && f.keywords.includes('settle')),
    caseType: 'merchant_settlement_delay',
    confidence: 0.88,
  },

  // Payment failed (with deduction signal)
  {
    name: 'payment_failed_with_deduction',
    condition: (f) =>
      f.keywords.some((k) => ['deducted_not_received', 'balance_deducted', 'amount_deducted'].includes(k)) ||
      (f.keywords.includes('deducted') && f.keywords.includes('failed')),
    caseType: 'payment_failed',
    confidence: 0.9,
  },
  {
    name: 'payment_failed_keywords',
    condition: (f) =>
      f.keywords.some((k) => ['payment_failed', 'failed', 'stuck', 'declined', 'error'].includes(k)),
    caseType: 'payment_failed',
    confidence: 0.8,
  },

  // Refund request
  {
    name: 'refund_request_keywords',
    condition: (f) =>
      f.keywords.some((k) => ['refund_request', 'refund', 'cashback'].includes(k)),
    caseType: 'refund_request',
    confidence: 0.85,
  },
];

/**
 * Run the rule engine against extracted facts.
 * Returns the first matching rule's case_type candidate.
 * Falls back to `other` (vague complaint) when no rule matches.
 */
export function runRuleEngine(facts: ExtractedFacts): RuleEngineResult {
  for (const rule of RULES) {
    if (rule.condition(facts)) {
      return {
        candidate: rule.caseType,
        ruleConfidence: rule.confidence,
        matchedRule: rule.name,
      };
    }
  }

  // Fallback: if extracted issue is a valid case type, use it
  if (facts.issue && (CASE_TYPES as readonly string[]).includes(facts.issue)) {
    return {
      candidate: facts.issue as CaseType,
      ruleConfidence: 0.6,
      matchedRule: 'issue_field_fallback',
    };
  }

  // Ultimate fallback — vague complaint → "other"
  return {
    candidate: 'other',
    ruleConfidence: 0.5,
    matchedRule: 'no_match_fallback',
  };
}

// M9 Severity Engine — SUST spec aligned.
// Combines case_type, amount, verdict, fraud, merchant/agent flags
// to produce low|medium|high|critical severity.

import type { CaseType, EvidenceVerdict, Severity } from '../schemas.js';
import { severityRules } from '../constants/index.js';

export interface SeverityResult {
  severity: Severity;
  severityReasons: string[];
}

const SEVERITY_ORDER: Severity[] = ['low', 'medium', 'high', 'critical'];

function severityIndex(s: string): number {
  return SEVERITY_ORDER.indexOf(s as Severity);
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return severityIndex(a) >= severityIndex(b) ? a : b;
}

/**
 * Calculate severity based on multiple signals.
 */
export function calculateSeverity(
  caseType: CaseType,
  amount: number | null,
  evidenceVerdict: EvidenceVerdict,
  fraud: boolean,
  hasMerchantFlag: boolean,
  hasAgentFlag: boolean
): SeverityResult {
  const reasons: string[] = [];

  // Start with base severity from case type
  const baseSev = (severityRules.base_severity[caseType] || 'medium') as Severity;
  let severity = baseSev;
  reasons.push(`Base severity for ${caseType}: ${baseSev}`);

  // Amount-based bumps
  if (amount !== null) {
    if (amount >= severityRules.amount_thresholds.high_value) {
      severity = maxSeverity(severity, 'critical');
      reasons.push(`Amount ${amount} BDT >= ${severityRules.amount_thresholds.high_value} → critical`);
    } else if (
      amount >= severityRules.amount_thresholds.medium_value &&
      evidenceVerdict === 'inconsistent'
    ) {
      severity = maxSeverity(severity, 'high');
      reasons.push(`Amount ${amount} BDT >= ${severityRules.amount_thresholds.medium_value} with inconsistent evidence → high`);
    }
  }

  // Fraud flag → critical
  if (fraud) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('Fraud flag detected → critical');
  }

  // Inconsistent evidence + high amount → critical
  if (evidenceVerdict === 'inconsistent' && amount !== null && amount >= severityRules.amount_thresholds.high_value) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('Inconsistent evidence with high amount → critical');
  }

  // Merchant/agent flags only apply to customer-side complaint types
  // (refund_request, payment_failed, wrong_transfer, duplicate_payment).
  // merchant_settlement_delay and agent_cash_in_issue are merchant/agent-side
  // by definition — the flag is expected and does not bump severity.
  const customerSideTypes = ['refund_request', 'payment_failed', 'wrong_transfer', 'duplicate_payment'];
  if ((hasMerchantFlag || hasAgentFlag) && customerSideTypes.includes(caseType)) {
    if (caseType !== 'refund_request') {
      severity = maxSeverity(severity, 'high');
      reasons.push(`${hasAgentFlag ? 'Agent' : 'Merchant'} flag → high`);
    }
  }

  // Established-recipient pattern softens a wrong_transfer to medium (SAMPLE-02)
  if (
    caseType === 'wrong_transfer' &&
    evidenceVerdict === 'inconsistent'
  ) {
    if (severityIndex(severity) > severityIndex('medium')) {
      severity = 'medium';
      reasons.push('Established-recipient pattern softens wrong_transfer to medium');
    }
  }

  // Ambiguous match softens a wrong_transfer to medium (SAMPLE-08)
  if (
    caseType === 'wrong_transfer' &&
    evidenceVerdict === 'insufficient_data'
  ) {
    if (severityIndex(severity) > severityIndex('medium')) {
      severity = 'medium';
      reasons.push('Ambiguous match softens wrong_transfer to medium');
    }
  }

  return { severity, severityReasons: reasons };
}

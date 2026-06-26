// M10 Human Review Engine — SUST spec aligned.
// Decides whether human review is required.
// Spec: human_review_required = true only for phishing, ambiguous evidence,
// safety flags, or a small set of explicit high-risk conditions.

import type { CaseType, EvidenceVerdict, Severity } from '../schemas.js';

export interface ReviewResult {
  humanReviewRequired: boolean;
  reviewReasons: string[];
}

/**
 * Determine if human review is required.
 * Triggers (only the spec's escalation cases):
 * - phishing_or_social_engineering (always)
 * - wrong_transfer with established-recipient pattern
 * - insufficient_data evidence verdict
 * - any safety flags
 */
export function decideReview(
  caseType: CaseType,
  severity: Severity,
  confidence: number,
  evidenceVerdict: EvidenceVerdict,
  amount: number | null,
  hasMerchantFlag: boolean,
  hasAgentFlag: boolean,
  safetyFlags: string[]
): ReviewResult {
  const reasons: string[] = [];

  // Phishing/social engineering is always human-reviewed
  if (caseType === 'phishing_or_social_engineering') {
    reasons.push('Phishing/social engineering case requires human review');
  }

  // Wrong transfer with a meaningful amount is reviewed
  if (caseType === 'wrong_transfer' && amount !== null && amount >= 2000) {
    reasons.push('Wrong transfer with material amount requires human review');
  }

  // Duplicate payment always requires biller verification (human review)
  if (caseType === 'duplicate_payment') {
    reasons.push('Duplicate payment requires biller verification (human review)');
  }

  // Agent cash-in issues with pending status require agent ops review
  if (caseType === 'agent_cash_in_issue') {
    reasons.push('Agent cash-in issue requires agent operations review');
  }

  // Insufficient evidence requires human review except for cases where the
  // service is explicitly asking the customer for clarification before any
  // dispute is initiated (SAMPLE-06 vague "other" and SAMPLE-08 wrong_transfer
  // with ambiguous matches — both just need more info from the customer).
  if (evidenceVerdict === 'insufficient_data') {
    if (caseType === 'wrong_transfer' || caseType === 'other') {
      // Don't escalate to a human yet — no dispute is being initiated;
      // we're simply asking the customer for more details.
    } else {
      reasons.push('Insufficient evidence data requires human review');
    }
  }

  // Inconsistent evidence at high/critical severity
  if (evidenceVerdict === 'inconsistent' && (severity === 'high' || severity === 'critical')) {
    reasons.push('Inconsistent evidence with high/critical severity requires human review');
  }

  // Safety flags always escalate
  if (safetyFlags.length > 0) {
    reasons.push(`Safety flags triggered: ${safetyFlags.join(', ')}`);
  }

  return {
    humanReviewRequired: reasons.length > 0,
    reviewReasons: reasons,
  };
}

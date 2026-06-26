// M7 Case Classifier
// Freezes final case_type from M4 rule engine candidate + safety override.
// Rejects any value outside the 8-value frozen enum (SUST spec).

import type { CaseType, ExtractedFacts } from '../schemas.js';
import { CASE_TYPES } from '../schemas.js';

export interface ClassifierResult {
  caseType: CaseType;
  classificationSource: string;
}

/**
 * Classify the case type from the rule engine candidate.
 * Safety override forces phishing_or_social_engineering if credential/injection signals detected.
 * Rejects any invented categories — only frozen enum values allowed.
 */
export function classifyCase(
  ruleCandidate: CaseType,
  facts: ExtractedFacts,
  safetyFlags: string[]
): ClassifierResult {
  // Safety override: if safety engine detected phishing signals, force phishing classification
  if (safetyFlags.includes('credential_request') || safetyFlags.includes('injection')) {
    return {
      caseType: 'phishing_or_social_engineering',
      classificationSource: 'safety_override',
    };
  }

  // Strong fraud signals override to phishing
  if (
    facts.fraud &&
    ruleCandidate !== 'phishing_or_social_engineering'
  ) {
    const strongFraudSignals = facts.keywords.some((k) =>
      ['pin_shared', 'otp_shared', 'pin_asked', 'otp_asked', 'phishing', 'fake'].includes(k)
    );
    if (strongFraudSignals) {
      return {
        caseType: 'phishing_or_social_engineering',
        classificationSource: 'fraud_signal_override',
      };
    }
  }

  // Validate that the candidate is in the frozen enum
  if ((CASE_TYPES as readonly string[]).includes(ruleCandidate)) {
    return {
      caseType: ruleCandidate,
      classificationSource: 'rule_engine',
    };
  }

  // Fallback: should never reach here, but safety net
  return {
    caseType: 'other',
    classificationSource: 'enum_violation_fallback',
  };
}

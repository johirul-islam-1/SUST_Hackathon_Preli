// M6 Evidence Reasoner — SUST spec aligned.
// Compares complaint issue vs chosen transaction.
// Returns consistent / inconsistent / insufficient_data.
// Never guesses.

import type { EvidenceVerdict, ExtractedFacts, Transaction } from '../schemas.js';

export interface ReasonerResult {
  evidenceVerdict: EvidenceVerdict;
  reasoning: string;
}

/**
 * Reason about the consistency between complaint facts and the matched transaction.
 * - consistent: transaction data supports the complaint
 * - inconsistent: transaction data contradicts the complaint
 * - insufficient_data: not enough evidence to determine
 */
export function reasonEvidence(
  facts: ExtractedFacts,
  matchedTransaction: Transaction | null,
  evidenceScore: number,
  allTransactions: Transaction[] = []
): ReasonerResult {
  // No matched transaction → insufficient
  if (!matchedTransaction) {
    return {
      evidenceVerdict: 'insufficient_data',
      reasoning: 'No matching transaction found in history. Cannot verify complaint.',
    };
  }

  const txnStatus = (matchedTransaction.status || '').toLowerCase();
  const issue = facts.issue;
  const inconsistencies: string[] = [];
  const consistencies: string[] = [];

  // Amount consistency
  if (facts.amount !== null) {
    if (matchedTransaction.amount === facts.amount) {
      consistencies.push(`Amount matches: ${facts.amount}`);
    } else {
      const diff = Math.abs(matchedTransaction.amount - facts.amount);
      const ratio = diff / Math.max(matchedTransaction.amount, facts.amount);
      if (ratio > 0.1) {
        inconsistencies.push(
          `Amount mismatch: complaint says ${facts.amount}, transaction shows ${matchedTransaction.amount}`
        );
      } else {
        consistencies.push(`Amount approximately matches (${matchedTransaction.amount} ≈ ${facts.amount})`);
      }
    }
  }

  // Status vs issue consistency (spec-aware)
  if (issue === 'payment_failed' || issue === 'payment_failure') {
    if (txnStatus === 'completed' || txnStatus === 'success') {
      inconsistencies.push(
        `Complaint claims payment failed but transaction status is "${txnStatus}"`
      );
    } else if (txnStatus === 'failed') {
      consistencies.push('Transaction status confirms payment failure');
    } else if (txnStatus === 'pending') {
      consistencies.push('Transaction is still pending — may explain payment issue');
    }
  } else if (issue === 'duplicate_payment') {
    if (txnStatus === 'completed') {
      consistencies.push('Transaction completed — duplicate-payment claim is plausible');
    }
  } else if (issue === 'wrong_transfer') {
    if (txnStatus === 'completed') {
      consistencies.push('Transaction completed — could be wrong recipient');
    }
    // Established-recipient pattern: 2+ prior completed transfers to the
    // same counterparty contradict a "wrong transfer" claim (SAMPLE-02).
    if (matchedTransaction.counterparty) {
      const priorSameRecipient = allTransactions.filter((t) =>
        t.transaction_id !== matchedTransaction.transaction_id &&
        (t.counterparty || '') === matchedTransaction.counterparty &&
        (t.status || '').toLowerCase() === 'completed'
      );
      if (priorSameRecipient.length >= 2) {
        inconsistencies.push(
          `Established-recipient pattern: ${priorSameRecipient.length} prior completed transfers to ${matchedTransaction.counterparty} contradict the wrong-transfer claim.`
        );
      }
    }
  } else if (issue === 'refund_request') {
    if (txnStatus === 'completed') {
      consistencies.push('Transaction completed — refund request is plausible');
    }
  } else if (issue === 'merchant_settlement_delay' || issue === 'agent_cash_in_issue') {
    if (txnStatus === 'pending') {
      consistencies.push('Transaction is still pending — matches settlement/cash-in claim');
    } else if (txnStatus === 'completed') {
      consistencies.push('Transaction completed — merchant settlement claim may already be resolved');
    }
  } else if (issue === 'phishing_or_social_engineering') {
    consistencies.push('Safety report — independent of transaction status');
  }

  // Determine verdict
  if (inconsistencies.length > 0 && consistencies.length === 0) {
    return {
      evidenceVerdict: 'inconsistent',
      reasoning: `Evidence contradicts complaint: ${inconsistencies.join('; ')}`,
    };
  }
  if (consistencies.length > 0 && inconsistencies.length === 0) {
    return {
      evidenceVerdict: 'consistent',
      reasoning: `Evidence supports complaint: ${consistencies.join('; ')}`,
    };
  }
  if (inconsistencies.length > 0 && consistencies.length > 0) {
    // Strong contradictions (e.g. established-recipient pattern) outweigh
    // generic consistencies like "amount matches".
    const hasStrongInconsistency = inconsistencies.some((s) =>
      /established-recipient|contradicts|status mismatch|amount mismatch/i.test(s)
    );
    if (hasStrongInconsistency || inconsistencies.length >= consistencies.length) {
      return {
        evidenceVerdict: 'inconsistent',
        reasoning: `Mixed evidence, leaning inconsistent: ${inconsistencies.join('; ')} vs ${consistencies.join('; ')}`,
      };
    }
    return {
      evidenceVerdict: 'consistent',
      reasoning: `Mixed evidence, leaning consistent: ${consistencies.join('; ')} vs ${inconsistencies.join('; ')}`,
    };
  }

  // Fall through — no specific signals
  if (evidenceScore >= 0.5) {
    return {
      evidenceVerdict: 'consistent',
      reasoning: `High evidence score (${(evidenceScore * 100).toFixed(0)}%) with no contradictions detected.`,
    };
  }
  return {
    evidenceVerdict: 'insufficient_data',
    reasoning: `Moderate evidence score (${(evidenceScore * 100).toFixed(0)}%) with no specific consistency indicators.`,
  };
}

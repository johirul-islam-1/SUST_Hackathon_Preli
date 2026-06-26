// M5 Transaction Evidence Matcher — SUST spec aligned.
// Weighted scoring: amount 40 / type 25 / time 20 / counterparty 10 / status 5
// Two extra rules:
//   1. Ambiguity: if the top two scored transactions are within 5% of each
//      other, return null (force `insufficient_data` in reasoner).
//   2. Duplicate: when the extracted issue is `duplicate_payment` and two
//      or more completed transactions share amount + counterparty within
//      60 s, prefer the later one (the suspected duplicate).

import type { Transaction, ExtractedFacts, ScoredTransaction } from '../schemas.js';
import { transactionTypes } from '../constants/index.js';

const WEIGHTS = {
  amount: 40,
  type: 25,
  time: 20,
  counterparty: 10,
  status: 5,
} as const;

const EVIDENCE_THRESHOLD = 25;
const AMBIGUITY_RATIO = 0.05; // top two within 5% → ambiguous

export interface EvidenceMatchResult {
  relevantTransactionId: string | null;
  evidenceScore: number;
  scoredTransactions: ScoredTransaction[];
}

/**
 * Score how well a transaction amount matches the complaint amount
 */
function scoreAmount(txnAmount: number, complainedAmount: number | null): number {
  if (complainedAmount === null) return 0;
  if (txnAmount === complainedAmount) return 1.0;

  const diff = Math.abs(txnAmount - complainedAmount);
  const ratio = diff / Math.max(txnAmount, complainedAmount);

  if (ratio < 0.01) return 0.95;
  if (ratio < 0.05) return 0.7;
  if (ratio < 0.1) return 0.5;
  if (ratio < 0.3) return 0.2;
  return 0;
}

function scoreType(txnType: string, complainedType: string | null): number {
  if (complainedType === null) return 0;
  const txnLower = txnType.toLowerCase();
  const complaintLower = complainedType.toLowerCase();
  if (txnLower === complaintLower) return 1.0;
  const typeKeywords = transactionTypes.types[complaintLower];
  if (typeKeywords) {
    for (const kw of typeKeywords) {
      if (txnLower.includes(kw) || kw.includes(txnLower)) return 0.8;
    }
  }
  for (const keywords of Object.values(transactionTypes.types)) {
    const txnMatch = keywords.some((kw) => txnLower.includes(kw) || kw.includes(txnLower));
    const complaintMatch = keywords.some(
      (kw) => complaintLower.includes(kw) || kw.includes(complaintLower)
    );
    if (txnMatch && complaintMatch) return 0.6;
  }
  return 0;
}

function scoreTime(txnTimestamp: string, timeHint: string | null): number {
  const txnDate = new Date(txnTimestamp);
  if (isNaN(txnDate.getTime())) return 0.1;

  const now = new Date();
  const hoursDiff = (now.getTime() - txnDate.getTime()) / (1000 * 60 * 60);

  if (timeHint) {
    const lower = timeHint.toLowerCase();
    if (lower.includes('just now') || lower.includes('এইমাত্র')) {
      return hoursDiff < 1 ? 1.0 : hoursDiff < 6 ? 0.5 : 0.1;
    }
    if (lower.includes('today') || lower.includes('আজ')) {
      return hoursDiff < 24 ? 0.8 : hoursDiff < 48 ? 0.4 : 0.1;
    }
    if (lower.includes('yesterday') || lower.includes('গতকাল')) {
      return hoursDiff >= 12 && hoursDiff <= 48 ? 0.9 : hoursDiff < 72 ? 0.5 : 0.1;
    }
  }

  if (hoursDiff < 24) return 0.7;
  if (hoursDiff < 72) return 0.5;
  if (hoursDiff < 168) return 0.3;
  if (hoursDiff < 720) return 0.15;
  return 0.05;
}

function scoreCounterparty(txnCounterparty: string, complainedCounterparty: string | null): number {
  if (!complainedCounterparty) return 0;
  if (!txnCounterparty) return 0;
  const txnCp = txnCounterparty.toLowerCase().trim();
  const complainCp = complainedCounterparty.toLowerCase().trim();
  if (txnCp === complainCp) return 1.0;
  if (txnCp.includes(complainCp) || complainCp.includes(txnCp)) return 0.7;
  return 0;
}

function scoreStatus(txnStatus: string, issue: string | null): number {
  const status = txnStatus.toLowerCase();
  if (!issue) return 0.3;

  if (issue === 'payment_failed' || issue === 'payment_failure') {
    if (status === 'failed') return 1.0;
    if (status === 'pending') return 0.7;
    if (status === 'completed') return 0.3;
    return 0.2;
  }

  if (issue === 'duplicate_payment' || issue === 'wrong_transfer' || issue === 'refund_request') {
    if (status === 'completed') return 0.9;
    if (status === 'pending') return 0.5;
    return 0.3;
  }

  if (issue === 'phishing_or_social_engineering') {
    if (status === 'completed') return 0.7;
    if (status === 'pending') return 0.5;
    return 0.3;
  }

  if (status === 'completed') return 0.6;
  if (status === 'pending') return 0.4;
  if (status === 'failed') return 0.3;
  return 0.2;
}

/**
 * Detect a duplicate-payment cluster: two or more `completed` transactions
 * that share the same amount and counterparty within 60 seconds.
 * Returns the latest one (the suspected duplicate), or null.
 */
function findDuplicatePair(transactions: Transaction[]): Transaction | null {
  const completed = transactions.filter(
    (t) => (t.status || '').toLowerCase() === 'completed'
  );
  for (let i = 0; i < completed.length; i++) {
    for (let j = i + 1; j < completed.length; j++) {
      const a = completed[i];
      const b = completed[j];
      if (!a || !b) continue;
      if (a.amount !== b.amount) continue;
      if ((a.counterparty || '') !== (b.counterparty || '')) continue;
      const dt = Math.abs(new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      if (dt <= 60_000) {
        // Return the later one
        return new Date(a.timestamp).getTime() >= new Date(b.timestamp).getTime() ? a : b;
      }
    }
  }
  return null;
}

/**
 * Score all transactions against complaint facts using weighted scoring.
 * Returns the best-matching transaction ID and its evidence score.
 */
export function matchEvidence(
  transactions: Transaction[],
  facts: ExtractedFacts
): EvidenceMatchResult {
  if (!transactions || transactions.length === 0) {
    return {
      relevantTransactionId: null,
      evidenceScore: 0,
      scoredTransactions: [],
    };
  }

  // Duplicate-payment shortcut: prefer the later of two near-identical txns
  if (facts.issue === 'duplicate_payment' || facts.issue === 'payment_failed') {
    const dup = findDuplicatePair(transactions);
    if (dup) {
      const score: ScoredTransaction = {
        transaction_id: dup.transaction_id,
        score: 90,
        breakdown: {
          amount: WEIGHTS.amount,
          type: WEIGHTS.type,
          time: 0,
          counterparty: facts.counterparty ? WEIGHTS.counterparty : 0,
          status: WEIGHTS.status,
        },
      };
      const others = transactions
        .filter((t) => t.transaction_id !== dup.transaction_id)
        .map((t) => ({
          transaction_id: t.transaction_id,
          score: 0,
          breakdown: { amount: 0, type: 0, time: 0, counterparty: 0, status: 0 },
        }));
      return {
        relevantTransactionId: dup.transaction_id,
        evidenceScore: 0.9,
        scoredTransactions: [score, ...others],
      };
    }
  }

  const scored: ScoredTransaction[] = transactions.map((txn) => {
    const breakdown = {
      amount: scoreAmount(txn.amount, facts.amount) * WEIGHTS.amount,
      type: scoreType(txn.type, facts.txnType) * WEIGHTS.type,
      time: scoreTime(txn.timestamp, facts.timeHint) * WEIGHTS.time,
      counterparty: scoreCounterparty(txn.counterparty || '', facts.counterparty) * WEIGHTS.counterparty,
      status: scoreStatus(txn.status, facts.issue) * WEIGHTS.status,
    };
    const score = breakdown.amount + breakdown.type + breakdown.time + breakdown.counterparty + breakdown.status;
    return { transaction_id: txn.transaction_id, score, breakdown };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  // Ambiguity rule: top two within 5% of each other → null
  if (
    best && second &&
    best.score > 0 &&
    second.score > 0 &&
    Math.abs(best.score - second.score) / best.score <= AMBIGUITY_RATIO &&
    best.score >= EVIDENCE_THRESHOLD
  ) {
    return {
      relevantTransactionId: null,
      evidenceScore: best.score / 100,
      scoredTransactions: scored,
    };
  }

  const relevantTransactionId =
    best && best.score >= EVIDENCE_THRESHOLD ? best.transaction_id : null;

  return {
    relevantTransactionId,
    evidenceScore: best ? best.score / 100 : 0,
    scoredTransactions: scored,
  };
}

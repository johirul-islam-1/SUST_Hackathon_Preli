import { z } from 'zod';

// ── Frozen Enums ────────────────────────────────────────────────────────────

export const CASE_TYPES = [
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'duplicate_payment',
  'merchant_settlement_delay',
  'agent_cash_in_issue',
  'phishing_or_social_engineering',
  'other',
] as const;

export const DEPARTMENTS = [
  'customer_support',
  'dispute_resolution',
  'payments_ops',
  'merchant_operations',
  'agent_operations',
  'fraud_risk',
] as const;

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export const EVIDENCE_VERDICTS = [
  'consistent',
  'inconsistent',
  'insufficient_data',
] as const;

export const CHANNELS = [
  'app',
  'web',
  'ussd',
  'agent',
  'merchant',
] as const;

export const USER_TYPES = [
  'customer',
  'agent',
  'merchant',
  'admin',
] as const;

export const LANGUAGES = ['en', 'bn', 'mixed'] as const;

// ── Zod Schema Types ────────────────────────────────────────────────────────

export const CaseTypeEnum = z.enum(CASE_TYPES);
export const DepartmentEnum = z.enum(DEPARTMENTS);
export const SeverityEnum = z.enum(SEVERITIES);
export const EvidenceVerdictEnum = z.enum(EVIDENCE_VERDICTS);
export const ChannelEnum = z.enum(CHANNELS);
export const UserTypeEnum = z.enum(USER_TYPES);
export const LanguageEnum = z.enum(LANGUAGES);

export type CaseType = z.infer<typeof CaseTypeEnum>;
export type Department = z.infer<typeof DepartmentEnum>;
export type Severity = z.infer<typeof SeverityEnum>;
export type EvidenceVerdict = z.infer<typeof EvidenceVerdictEnum>;
export type Channel = z.infer<typeof ChannelEnum>;
export type UserType = z.infer<typeof UserTypeEnum>;
export type Language = z.infer<typeof LanguageEnum>;

// ── Transaction Schema ──────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  transaction_id: z.string().min(1),
  amount: z.number(),
  type: z.string().min(1),
  timestamp: z.string().min(1),
  status: z.string().min(1),
  counterparty: z.string().optional().default(''),
  channel: z.string().optional().default(''),
  reference: z.string().optional().default(''),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// ── Ticket Request Schema ───────────────────────────────────────────────────

export const TicketRequestSchema = z.object({
  ticket_id: z.string().min(1),
  complaint: z.string().min(1, 'Complaint cannot be empty'),
  customer_name: z.string().optional().default(''),
  customer_id: z.string().optional().default(''),
  channel: z.string().optional().default('app'),
  user_type: z.string().optional().default('customer'),
  language: z.string().optional().default('en'),
  transaction_history: z.array(TransactionSchema).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({}),
});

export type TicketRequest = z.infer<typeof TicketRequestSchema>;

// ── Extracted Facts ─────────────────────────────────────────────────────────

export const ExtractedFactsSchema = z.object({
  amount: z.number().nullable(),
  issue: z.string().nullable(),
  txnType: z.string().nullable(),
  timeHint: z.string().nullable(),
  counterparty: z.string().nullable(),
  merchant: z.string().nullable(),
  fraud: z.boolean(),
  keywords: z.array(z.string()),
});

export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

// ── Scored Transaction ──────────────────────────────────────────────────────

export interface ScoredTransaction {
  transaction_id: string;
  score: number;
  breakdown: {
    amount: number;
    type: number;
    time: number;
    counterparty: number;
    status: number;
  };
}

// ── Ticket Response Schema ──────────────────────────────────────────────────

export const TicketResponseSchema = z.object({
  ticket_id: z.string().min(1),
  case_type: CaseTypeEnum,
  department: DepartmentEnum,
  severity: SeverityEnum,
  confidence: z.number().min(0).max(1),
  evidence_verdict: EvidenceVerdictEnum,
  relevant_transaction_id: z.string().nullable(),
  reason_codes: z.array(z.string()),
  human_review_required: z.boolean(),
  customer_reply: z.string().min(1),
  agent_summary: z.string(),
  recommended_next_action: z.string(),
});

export type TicketResponse = z.infer<typeof TicketResponseSchema>;

// ── Pipeline Context (internal, passed between modules) ─────────────────────

export interface PipelineContext {
  // raw input
  request: TicketRequest;
  // M2 output
  normalizedComplaint: string;
  detectedLanguage: Language;
  tokens: string[];
  // M3 output
  facts: ExtractedFacts;
  factConfidence: number;
  // M4 output
  ruleCandidate: CaseType;
  ruleConfidence: number;
  // M5 output
  relevantTransactionId: string | null;
  evidenceScore: number;
  scoredTransactions: ScoredTransaction[];
  // M6 output
  evidenceVerdict: EvidenceVerdict;
  // M7 output
  caseType: CaseType;
  // M8 output
  department: Department;
  // M9 output
  severity: Severity;
  // M10 output
  humanReviewRequired: boolean;
  reviewReasons: string[];
  // M11 output
  customerReply: string;
  agentSummary: string;
  recommendedNextAction: string;
  // Confidence
  confidence: number;
  // Safety flags
  safetyFlags: string[];
  reasonCodes: string[];
}

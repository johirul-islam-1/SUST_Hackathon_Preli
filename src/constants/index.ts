// Constants loader — loads all JSON constants at boot time

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadJson<T>(filename: string): T {
  const raw = readFileSync(join(__dirname, filename), 'utf-8');
  return JSON.parse(raw) as T;
}

export interface CaseTypeKeywords {
  [caseType: string]: {
    en: string[];
    bn: string[];
    banglish: string[];
  };
}

export interface SafetyRedflags {
  input_patterns: {
    credential_request: string[];
    injection: string[];
    unsafe_instruction: string[];
  };
  output_patterns: {
    credentials: string[];
    refund_promise: string[];
    unofficial_contact: string[];
  };
  safe_replacement_keywords: string[];
}

export interface AmountWords {
  currency_patterns: Array<{ pattern: string; replacement: string }>;
  amount_regex: string;
  bangla_digits: Record<string, string>;
}

export interface TransactionTypes {
  types: Record<string, string[]>;
  status_keywords: Record<string, string[]>;
}

export interface DepartmentLookup {
  wrong_transfer: string;
  payment_failed: string;
  refund_request: string;
  duplicate_payment: string;
  merchant_settlement_delay: string;
  agent_cash_in_issue: string;
  phishing_or_social_engineering: string;
  other: string;
  overrides: Record<string, string>;
}

export interface SeverityRules {
  base_severity: Record<string, string>;
  amount_thresholds: { high_value: number; medium_value: number };
  bump_rules: Array<{ condition: string; bump_to: string }>;
  severity_order: string[];
}

export interface ReplyTemplates {
  customer_reply: {
    en: Record<string, string>;
    bn: Record<string, string>;
  };
  agent_summary: Record<string, string>;
  recommended_next_action: Record<string, string>;
  safe_fallback: { en: string; bn: string };
}

// Load all constants once at boot
export const caseTypeKeywords = loadJson<CaseTypeKeywords>('case_types.json');
export const safetyRedflags = loadJson<SafetyRedflags>('safety_redflags.json');
export const amountWords = loadJson<AmountWords>('amount_words.json');
export const transactionTypes = loadJson<TransactionTypes>('transaction_types.json');
export const departmentLookup = loadJson<DepartmentLookup>('department_lookup.json');
export const severityRules = loadJson<SeverityRules>('severity_rules.json');
export const replyTemplates = loadJson<ReplyTemplates>('reply_templates.json');

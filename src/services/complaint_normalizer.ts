// M2 Complaint Normalizer
// Tokenizes en/bn/banglish text; normalizes currency; detects language.

import type { Language } from '../schemas.js';
import { amountWords } from '../constants/index.js';

// Bengali Unicode range: U+0980–U+09FF
const BENGALI_REGEX = /[\u0980-\u09FF]/g;

export interface NormalizerResult {
  normalizedComplaint: string;
  tokens: string[];
  detectedLanguage: Language;
}

/**
 * Convert Bengali digits to ASCII digits
 */
function convertBanglaDigits(text: string): string {
  let result = text;
  for (const [bn, en] of Object.entries(amountWords.bangla_digits)) {
    result = result.replace(new RegExp(bn, 'g'), en);
  }
  return result;
}

/**
 * Normalize currency references to BDT
 */
function normalizeCurrency(text: string): string {
  let result = text;
  for (const { pattern, replacement } of amountWords.currency_patterns) {
    // Case-insensitive replacement, word-boundary aware for short patterns
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex =
      pattern.length <= 3
        ? new RegExp(`\\b${escaped}\\b`, 'gi')
        : new RegExp(escaped, 'gi');
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Detect language based on Bengali Unicode character ratio
 */
function detectLanguage(text: string): Language {
  const bengaliMatches = text.match(BENGALI_REGEX);
  const bengaliCount = bengaliMatches ? bengaliMatches.length : 0;
  const totalChars = text.replace(/\s/g, '').length;

  if (totalChars === 0) return 'en';

  const bengaliRatio = bengaliCount / totalChars;

  if (bengaliRatio > 0.4) return 'bn';
  if (bengaliRatio > 0.05) return 'mixed';
  return 'en';
}

/**
 * Common Banglish phrase normalization
 */
const BANGLISH_MAP: Record<string, string> = {
  'payment hoy nai': 'payment_failed',
  'payment hoini': 'payment_failed',
  'balance komse': 'balance_deducted',
  'balance kom': 'balance_deducted',
  'taka nai': 'balance_missing',
  'taka katse': 'amount_deducted',
  'taka katse kintu': 'deducted_not_received',
  'taka ferot': 'refund_request',
  'taka firiye': 'refund_request',
  'refund chai': 'refund_request',
  'vul number': 'wrong_number',
  'vule pathiyechi': 'wrong_transfer',
  'pin cheyeche': 'pin_asked',
  'otp cheyeche': 'otp_asked',
  'pin diyechi': 'pin_shared',
  'otp diyechi': 'otp_shared',
  'product pai nai': 'product_not_received',
  'service pai nai': 'service_not_received',
  // English phrases that map to canonical keyword tokens used by the rule engine.
  // Without these the rule engine never sees "otp_asked"/"pin_asked" in tokens.
  'asked for my pin': 'pin_asked',
  'asked for my otp': 'otp_asked',
  'asked for pin': 'pin_asked',
  'asked for otp': 'otp_asked',
  'asking for pin': 'pin_asked',
  'asking for otp': 'otp_asked',
  'asked for my password': 'password_asked',
  'asked for password': 'password_asked',
  'shared my pin': 'pin_shared',
  'shared my otp': 'otp_shared',
  'gave my pin': 'pin_shared',
  'gave my otp': 'otp_shared',
  'i shared my pin': 'pin_shared',
  'i shared my otp': 'otp_shared',
  'i gave my pin': 'pin_shared',
  'i gave my otp': 'otp_shared',
  'sent money to wrong': 'wrong_transfer',
  'sent it to wrong': 'wrong_transfer',
  'paid twice': 'duplicate_payment',
  'paid two times': 'duplicate_payment',
  'deducted twice': 'duplicate_payment',
  'deducted two times': 'duplicate_payment',
  'change my mind': 'refund_request',
  'changed my mind': 'refund_request',
  'settlement delayed': 'merchant_settlement',
  'settlement has not': 'merchant_settlement',
  'sales have not been settled': 'merchant_settlement',
  'balance deducted': 'balance_deducted',
  'balance was deducted': 'balance_deducted',
  'deducted from my account': 'balance_deducted',
};

/**
 * Normalize a complaint string:
 * 1. Lowercase
 * 2. Convert Bengali digits
 * 3. Normalize currency
 * 4. Strip excess punctuation
 * 5. Collapse whitespace
 * 6. Replace Banglish phrases
 * 7. Tokenize
 */
export function normalizeComplaint(complaint: string): NormalizerResult {
  let text = complaint.toLowerCase();

  // Convert Bengali digits to ASCII
  text = convertBanglaDigits(text);

  // Detect language before heavy normalization
  const detectedLanguage = detectLanguage(text);

  // Normalize currency
  text = normalizeCurrency(text);

  // Strip punctuation but keep Bengali characters, digits, spaces
  text = text.replace(/[^\w\s\u0980-\u09FF]/g, ' ');

  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // Apply Banglish phrase mapping
  for (const [phrase, replacement] of Object.entries(BANGLISH_MAP)) {
    if (text.includes(phrase)) {
      text = text.replace(new RegExp(phrase, 'g'), replacement);
    }
  }

  const tokens = text.split(/\s+/).filter((t) => t.length > 0);

  return {
    normalizedComplaint: text,
    tokens,
    detectedLanguage,
  };
}

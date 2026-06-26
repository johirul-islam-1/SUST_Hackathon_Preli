// M3 Fact Extractor
// Extracts structured facts from normalized complaint tokens.
// Never classifies — only extracts raw evidence.

import type { ExtractedFacts } from '../schemas.js';
import { amountWords, caseTypeKeywords, transactionTypes } from '../constants/index.js';

export interface FactExtractionResult {
  facts: ExtractedFacts;
  factConfidence: number;
}

/**
 * Extract monetary amount from text
 */
function extractAmount(text: string): number | null {
  const regex = new RegExp(amountWords.amount_regex, 'gi');
  const matches: number[] = [];

  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const cleaned = match[1].replace(/,/g, '');
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 0) {
        // Reject phone-number-shaped amounts (10+ contiguous digits with no
        // currency marker in front). Phone numbers often leak through the
        // generic amount regex and dominate the "largest amount" heuristic.
        const isLikelyPhone = cleaned.replace(/\D/g, '').length >= 10 &&
          !/(?:BDT|৳|tk|taka|টাকা)/i.test(match[0]);
        if (isLikelyPhone) continue;
        matches.push(num);
      }
    }
  }

  // Return the largest amount mentioned (most likely the disputed amount)
  return matches.length > 0 ? Math.max(...matches) : null;
}

/**
 * Detect transaction type from tokens
 */
function extractTxnType(tokens: string[]): string | null {
  const text = tokens.join(' ');
  for (const [type, keywords] of Object.entries(transactionTypes.types)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        return type;
      }
    }
  }
  return null;
}

/**
 * Detect issue type by matching against case_type keyword lists.
 * Returns the issue keyword group with the highest match count.
 * Does NOT classify — just identifies the primary issue signal.
 * Requires a minimum specificity threshold: vague complaints that match
 * only single weak words (e.g. "wrong" alone) are mapped to "other".
 */
function extractIssue(tokens: string[], text: string): string | null {
  const scores: Array<{ issue: string; score: number; matched: string[] }> = [];

  for (const [issue, langs] of Object.entries(caseTypeKeywords)) {
    let score = 0;
    const matched: string[] = [];
    const allKeywords = [...langs.en, ...langs.bn, ...langs.banglish];
    for (const kw of allKeywords) {
      if (text.includes(kw.toLowerCase())) {
        score++;
        matched.push(kw);
      }
    }
    if (score > 0) {
      scores.push({ issue, score, matched });
    }
  }

  if (scores.length === 0) return null;

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Specificity gate: vague complaints that match only one short common word
  // should not be classified as a specific case type.
  // A strong signal is any multi-word keyword (length >= 8 chars) or a
  // specific term like "phishing"/"duplicate"/"settlement".
  const SPECIFIC_TERMS = [
    'payment', 'phishing', 'duplicate', 'settlement', 'cashin', 'recharge',
    'refund', 'wrong', 'unauthorized', 'fraud',
  ];
  const hasStrongSignal = best.matched.some((m) => {
    const lower = m.toLowerCase();
    if (m.length >= 8) return true; // multi-word phrase
    return SPECIFIC_TERMS.some((s) => lower.includes(s));
  });

  if (!hasStrongSignal && best.score < 2) {
    return 'other';
  }

  return best.issue;
}

/**
 * Extract time hint (e.g., "yesterday", "2 hours ago", "last week")
 */
function extractTimeHint(text: string): string | null {
  const timePatterns = [
    /(?:yesterday|গতকাল)/i,
    /(\d+)\s*(?:hours?|hrs?|ঘণ্টা)\s*ago/i,
    /(\d+)\s*(?:minutes?|mins?|মিনিট)\s*ago/i,
    /(\d+)\s*(?:days?|দিন)\s*ago/i,
    /(?:today|আজ|আজকে)/i,
    /(?:last\s*week|গত\s*সপ্তাহ)/i,
    /(?:last\s*month|গত\s*মাস)/i,
    /(?:this\s*morning|আজ\s*সকাল)/i,
    /(?:just\s*now|এইমাত্র)/i,
    /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/,
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }

  return null;
}

/**
 * Extract counterparty (phone number or name mentioned)
 */
function extractCounterparty(text: string): string | null {
  // Phone number pattern (Bangladeshi: 01XXXXXXXXX)
  const phoneMatch = text.match(/\b(01\d{9})\b/);
  if (phoneMatch) return phoneMatch[1];

  // Generic phone-like pattern
  const genericPhone = text.match(/\b(\+?\d{10,13})\b/);
  if (genericPhone) return genericPhone[1];

  return null;
}

/**
 * Detect merchant/agent references
 */
function extractMerchant(tokens: string[], text: string): string | null {
  const merchantKeywords = ['merchant', 'shop', 'store', 'dokan', 'বিক্রেতা', 'মার্চেন্ট', 'দোকান'];
  const agentKeywords = ['agent', 'এজেন্ট'];

  for (const kw of [...merchantKeywords, ...agentKeywords]) {
    if (text.includes(kw)) {
      return kw;
    }
  }
  return null;
}

/**
 * Detect fraud indicators
 */
function detectFraud(tokens: string[], text: string): boolean {
  const fraudKeywords = [
    'fraud', 'scam', 'stolen', 'hacked', 'phishing', 'cheated', 'tricked',
    'unauthorized', 'not authorized', 'someone else', 'fake', 'impersonator',
    'প্রতারণা', 'চুরি', 'হ্যাক', 'ফিশিং', 'ভুয়া',
    'pratarit', 'churi', 'hack',
    'pin diyechi', 'otp diyechi', 'pin_shared', 'otp_shared', 'pin_asked', 'otp_asked',
  ];

  // Phishing / social-engineering tokens added to the token list by the
  // normalizer (e.g. "asked for my otp" → "otp_asked"). If any of those tokens
  // are present, treat the complaint as a fraud signal.
  const phishingTokens = ['otp_asked', 'pin_asked', 'password_asked', 'pin_shared', 'otp_shared', 'phishing'];
  if (tokens.some((t) => phishingTokens.includes(t))) return true;

  return fraudKeywords.some((kw) => text.includes(kw));
}

/**
 * Extract all facts from normalized complaint text + tokens.
 * Returns facts + confidence score based on how many facts were extracted.
 */
export function extractFacts(normalizedText: string, tokens: string[]): FactExtractionResult {
  const amount = extractAmount(normalizedText);
  const issue = extractIssue(tokens, normalizedText);
  const txnType = extractTxnType(tokens);
  const timeHint = extractTimeHint(normalizedText);
  const counterparty = extractCounterparty(normalizedText);
  const merchant = extractMerchant(tokens, normalizedText);
  const fraud = detectFraud(tokens, normalizedText);

  const facts: ExtractedFacts = {
    amount,
    issue,
    txnType,
    timeHint,
    counterparty,
    merchant,
    fraud,
    keywords: tokens.filter((t) => t.length > 2),
  };

  // Calculate fact confidence based on how many fields were extracted
  let fieldsFound = 0;
  const totalFields = 6; // amount, issue, txnType, timeHint, counterparty, merchant

  if (amount !== null) fieldsFound++;
  if (issue !== null) fieldsFound += 2; // Issue is weighted higher
  if (txnType !== null) fieldsFound++;
  if (timeHint !== null) fieldsFound++;
  if (counterparty !== null) fieldsFound++;
  if (merchant !== null) fieldsFound++;
  if (fraud) fieldsFound++; // Fraud is a strong signal

  const factConfidence = Math.min(1, fieldsFound / totalFields);

  return { facts, factConfidence };
}

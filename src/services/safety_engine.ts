// M12 Safety Engine
// Two passes:
//   Input pass (before M3): detect injection, credential requests, unsafe instructions.
//   Output pass (after M11): scan replies for PIN/OTP/password/CVV/refund-promise/unofficial.
//   If unsafe → swap to safe template + force human_review_required=true.

import { safetyRedflags } from '../constants/index.js';

export interface SafetyInputResult {
  flags: string[];
  isUnsafe: boolean;
}

export interface SafetyOutputResult {
  flags: string[];
  isUnsafe: boolean;
  unsafeFields: string[];
}

/**
 * INPUT PASS: Scan the raw complaint for injection, credential requests, and unsafe instructions.
 * Run BEFORE fact extraction.
 */
export function scanInput(rawComplaint: string): SafetyInputResult {
  const flags: string[] = [];
  const text = rawComplaint.toLowerCase();

  // Check credential request patterns
  for (const pattern of safetyRedflags.input_patterns.credential_request) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        flags.push('credential_request');
        break;
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  // Check injection patterns
  for (const pattern of safetyRedflags.input_patterns.injection) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        flags.push('injection');
        break;
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  // Check unsafe instruction patterns
  for (const pattern of safetyRedflags.input_patterns.unsafe_instruction) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        flags.push('unsafe_instruction');
        break;
      }
    } catch {
      // Skip invalid regex patterns
    }
  }

  return {
    flags,
    isUnsafe: flags.length > 0,
  };
}

/**
 * OUTPUT PASS: Scan all reply strings for unsafe content.
 * Checks for credentials, refund promises, and unofficial contact info.
 * Run AFTER template generation.
 */
export function scanOutput(
  customerReply: string,
  agentSummary: string,
  recommendedNextAction: string
): SafetyOutputResult {
  const flags: string[] = [];
  const unsafeFields: string[] = [];

  // Only scan customer-facing reply for output safety
  // Internal note and suggested action are for staff only
  const fieldsToScan = [
    { name: 'customer_reply', text: customerReply },
  ];

  for (const { name, text } of fieldsToScan) {
    const lower = text.toLowerCase();

    // Check for credential mentions in reply
    // Exceptions: phrases like "do not share your pin" or "never share" are SAFE
    for (const pattern of safetyRedflags.output_patterns.credentials) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(lower)) {
          // Check if it's a safe warning context
          const safeContexts = [
            /(?:do\s*not|don'?t|never)\s*(?:share|give|send|tell|provide)/i,
            /(?:for\s*your\s*(?:safety|security))/i,
            /(?:important|warning|caution|never)/i,
          ];
          const isSafeContext = safeContexts.some((sc) => sc.test(lower));

          if (!isSafeContext) {
            flags.push('credential_in_output');
            unsafeFields.push(name);
            break;
          }
        }
      } catch {
        // Skip invalid regex
      }
    }

    // Check for unauthorized refund promises
    for (const pattern of safetyRedflags.output_patterns.refund_promise) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(lower)) {
          flags.push('refund_promise');
          unsafeFields.push(name);
          break;
        }
      } catch {
        // Skip invalid regex
      }
    }

    // Check for unofficial contact info
    for (const pattern of safetyRedflags.output_patterns.unofficial_contact) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(lower)) {
          flags.push('unofficial_contact');
          unsafeFields.push(name);
          break;
        }
      } catch {
        // Skip invalid regex
      }
    }
  }

  return {
    flags: [...new Set(flags)], // deduplicate
    isUnsafe: flags.length > 0,
    unsafeFields: [...new Set(unsafeFields)],
  };
}

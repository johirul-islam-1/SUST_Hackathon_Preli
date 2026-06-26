// M13 Output Validator
// Re-validates the assembled response against the response Zod schema.
// Rejects invalid JSON before send.
// Throws on schema violation → caller returns 500 with non-sensitive message.

import { TicketResponseSchema, type TicketResponse } from '../schemas.js';
import { ZodError } from 'zod';

export interface OutputValidationResult {
  valid: boolean;
  data?: TicketResponse;
  error?: string;
}

/**
 * Validate the final assembled response against the TicketResponse Zod schema.
 * Checks: required fields, types, enum values, null handling, confidence ∈ [0,1], boolean types.
 */
export function validateOutput(response: unknown): OutputValidationResult {
  try {
    const data = TicketResponseSchema.parse(response);
    return { valid: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return {
        valid: false,
        error: `Output validation failed: ${issues}`,
      };
    }
    return {
      valid: false,
      error: 'Output validation failed: unknown error',
    };
  }
}

// M1 Request Validator
// Validates incoming ticket JSON against Zod schema.
// Returns structured errors mapped to 400/422 status codes.
// Never leaks stack traces or internal details.

import { TicketRequestSchema, type TicketRequest } from '../schemas.js';
import { ZodError } from 'zod';

export interface ValidationResult {
  valid: boolean;
  data?: TicketRequest;
  error?: {
    status: 400 | 422;
    body: { error: string; details?: string[] };
  };
}

export function validateRequest(body: unknown): ValidationResult {
  // Check if body exists and is an object
  if (body === null || body === undefined || typeof body !== 'object') {
    return {
      valid: false,
      error: {
        status: 400,
        body: { error: 'Request body must be a valid JSON object' },
      },
    };
  }

  try {
    const data = TicketRequestSchema.parse(body);

    // Additional validation: complaint must have meaningful content
    if (data.complaint.trim().length === 0) {
      return {
        valid: false,
        error: {
          status: 422,
          body: { error: 'Complaint cannot be empty or whitespace only' },
        },
      };
    }

    return { valid: true, data };
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => {
        const path = i.path.join('.');
        return `${path}: ${i.message}`;
      });

      // Missing required fields → 400; semantic issues → 422
      const hasMissingRequired = err.issues.some(
        (i) => i.code === 'invalid_type' && i.received === 'undefined'
      );

      return {
        valid: false,
        error: {
          status: hasMissingRequired ? 400 : 422,
          body: {
            error: 'Validation failed',
            details: issues,
          },
        },
      };
    }

    return {
      valid: false,
      error: {
        status: 400,
        body: { error: 'Invalid request format' },
      },
    };
  }
}

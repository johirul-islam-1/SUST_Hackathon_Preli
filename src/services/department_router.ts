// M8 Department Router — SUST spec aligned.
// Maps case_type → department with overrides for edge cases.

import type { CaseType, Department } from '../schemas.js';
import { departmentLookup } from '../constants/index.js';
import { DEPARTMENTS } from '../schemas.js';

export interface RoutingResult {
  department: Department;
  routingSource: string;
}

/**
 * Route a case to the appropriate department based on case_type.
 * Adjustments:
 *   - phishing → fraud_risk
 *   - ambiguous → customer_support
 *   - agent cash-in issues → agent_operations
 *   - merchant settlement issues → merchant_operations
 */
export function routeDepartment(
  caseType: CaseType,
  amount: number | null,
  hasMerchantFlag: boolean,
  hasAgentFlag: boolean,
  confidence: number
): RoutingResult {
  // High-value ambiguous cases → customer_support
  if (amount !== null && amount >= 50000 && confidence < 0.5) {
    return {
      department: 'customer_support',
      routingSource: 'high_value_low_confidence_override',
    };
  }

  // Standard lookup from spec table
  const lookedUp = departmentLookup[caseType];
  if (lookedUp && (DEPARTMENTS as readonly string[]).includes(lookedUp)) {
    return {
      department: lookedUp as Department,
      routingSource: 'standard_lookup',
    };
  }

  // Fallback
  return {
    department: 'customer_support',
    routingSource: 'fallback',
  };
}

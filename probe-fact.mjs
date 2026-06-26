import { extractFacts } from './src/services/fact_extractor.ts';
import { normalizeComplaint } from './src/services/complaint_normalizer.ts';

const complaints = [
  "Something is wrong with my money. Please check.",
  "I sent 5000 taka to a wrong number around 2pm today.",
];

for (const c of complaints) {
  const { normalizedComplaint, tokens } = normalizeComplaint(c);
  const { facts } = extractFacts(normalizedComplaint, tokens);
  console.log(JSON.stringify({ complaint: c, issue: facts.issue, amount: facts.amount, txnType: facts.txnType, counterparty: facts.counterparty, tokens }));
}

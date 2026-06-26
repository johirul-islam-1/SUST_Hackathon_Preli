// Sample-case runner: reads sample cases, posts to local service, diffs against expected_output.
// Usage: npx tsx scripts/run-samples.ts

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

interface SampleCase {
  input: Record<string, unknown>;
  expected_output: Record<string, unknown>;
}

const BASE_URL = process.env['BASE_URL'] || 'http://localhost:8080';

async function runSamples() {
  const samplesPath = join(ROOT, 'samples', 'SUST_Preli_Sample_Cases.json');
  const cases: SampleCase[] = JSON.parse(readFileSync(samplesPath, 'utf-8'));

  console.log(`\n🔬 Running ${cases.length} sample cases against ${BASE_URL}\n`);
  console.log('─'.repeat(70));

  const results: Array<{
    ticketId: string;
    pass: boolean;
    diffs: string[];
    response: Record<string, unknown> | null;
    latencyMs: number;
  }> = [];

  const latencies: number[] = [];

  for (const sample of cases) {
    const ticketId = sample.input['ticket_id'] as string;
    const startTime = Date.now();

    try {
      const res = await fetch(`${BASE_URL}/analyze-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sample.input),
      });

      const latencyMs = Date.now() - startTime;
      latencies.push(latencyMs);

      if (res.status !== 200) {
        console.log(`❌ ${ticketId}: HTTP ${res.status}`);
        results.push({ ticketId, pass: false, diffs: [`HTTP ${res.status}`], response: null, latencyMs });
        continue;
      }

      const response = await res.json() as Record<string, unknown>;
      const diffs: string[] = [];

      // Compare expected fields
      for (const [key, expectedValue] of Object.entries(sample.expected_output)) {
        const actualValue = response[key];
        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
          diffs.push(`  ${key}: expected=${JSON.stringify(expectedValue)}, got=${JSON.stringify(actualValue)}`);
        }
      }

      // Check no banned phrases in customer_reply
      const reply = (response['customer_reply'] as string || '').toLowerCase();
      const bannedPatterns = [/\bpin\b/, /\botp\b/, /\bpassword\b/, /\bcvv\b/];
      // Exception for safety warnings
      const isSafeWarning = /(?:do\s*not|don'?t|never)\s*(?:share|give)/.test(reply);
      if (!isSafeWarning) {
        for (const bp of bannedPatterns) {
          if (bp.test(reply)) {
            diffs.push(`  BANNED PHRASE in customer_reply: ${bp.source}`);
          }
        }
      }

      const pass = diffs.length === 0;
      console.log(`${pass ? '✅' : '❌'} ${ticketId} (${latencyMs}ms)${diffs.length > 0 ? '\n' + diffs.join('\n') : ''}`);
      results.push({ ticketId, pass, diffs, response, latencyMs });

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      console.log(`❌ ${ticketId}: ${(err as Error).message}`);
      results.push({ ticketId, pass: false, diffs: [(err as Error).message], response: null, latencyMs });
    }
  }

  console.log('\n' + '─'.repeat(70));
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n📊 Results: ${passed}/${total} passed`);

  if (latencies.length > 0) {
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    console.log(`⏱  Latency: p50=${p50}ms, p95=${p95}ms`);
  }

  // Write output report
  mkdirSync(join(ROOT, 'samples'), { recursive: true });
  const reportLines = [
    '# Sample Case Results',
    '',
    `Run at: ${new Date().toISOString()}`,
    `Passed: ${passed}/${total}`,
    '',
    '| Ticket | Pass | Latency | Diffs |',
    '|--------|------|---------|-------|',
    ...results.map((r) =>
      `| ${r.ticketId} | ${r.pass ? '✅' : '❌'} | ${r.latencyMs}ms | ${r.diffs.join('; ') || '-'} |`
    ),
  ];
  writeFileSync(join(ROOT, 'samples', 'output.md'), reportLines.join('\n'), 'utf-8');

  // Save first case output for submission
  const firstResult = results.find((r) => r.ticketId === 'TKT-001');
  if (firstResult?.response) {
    writeFileSync(
      join(ROOT, 'samples', 'output_TKT-001.json'),
      JSON.stringify(firstResult.response, null, 2),
      'utf-8'
    );
    console.log('\n📄 Saved samples/output_TKT-001.json');
  }

  console.log('📄 Saved samples/output.md\n');

  // Exit with error code if any failed
  if (passed < total) process.exit(1);
}

runSamples().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

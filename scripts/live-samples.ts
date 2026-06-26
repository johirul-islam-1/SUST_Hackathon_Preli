// Live sample runner — starts the server, posts each sample to /analyze-ticket,
// shows the actual response side-by-side with expected output, and reports
// pass/fail per case. Usage: npx tsx scripts/live-samples.ts

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn, type ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const PORT = process.env['PORT'] || '8080';
const BASE_URL = `http://127.0.0.1:${PORT}`;

interface SampleCase {
  id: string;
  label: string;
  input: Record<string, unknown>;
  expected_output: Record<string, unknown>;
  rationale?: string;
}

interface RunResult {
  id: string;
  label: string;
  ok: boolean;
  httpStatus: number;
  diffs: string[];
  actual: Record<string, unknown> | null;
  latencyMs: number;
  error?: string;
}

function startServer(): ChildProcess {
  // On Windows, `npx` is a .cmd shim — spawn it through the user's shell so it resolves correctly.
  const isWin = process.platform === 'win32';
  const cmd = isWin ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['tsx', 'src/server.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWin,
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

async function waitForHealth(timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function compareCase(actual: Record<string, unknown>, expected: Record<string, unknown>): string[] {
  const diffs: string[] = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      diffs.push(`  ${key}: expected=${JSON.stringify(expectedValue)}, got=${JSON.stringify(actualValue)}`);
    }
  }
  // Safety check: customer_reply must not contain banned phrases
  const reply = (actual['customer_reply'] as string || '').toLowerCase();
  const bannedPatterns: Array<{ name: string; re: RegExp }> = [
    { name: 'pin', re: /\bpin\b/ },
    { name: 'otp', re: /\botp\b/ },
    { name: 'password', re: /\bpassword\b/ },
    { name: 'cvv', re: /\bcvv\b/ },
    { name: 'we will refund', re: /\bwe will refund\b/ },
    { name: 'we have refunded', re: /\bwe have refunded\b/ },
  ];
  const isSafeWarning = /(?:do\s*not|don'?t|never)\s*(?:share|give|ask)/.test(reply);
  if (!isSafeWarning) {
    for (const bp of bannedPatterns) {
      if (bp.re.test(reply)) {
        diffs.push(`  SAFETY: customer_reply contains banned phrase "${bp.name}"`);
      }
    }
  }
  return diffs;
}

async function runCase(s: SampleCase): Promise<RunResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/analyze-ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s.input),
    });
    const latencyMs = Date.now() - start;
    const actual = (await res.json()) as Record<string, unknown>;
    const diffs = res.ok ? compareCase(actual, s.expected_output) : [`HTTP ${res.status}`];
    return {
      id: s.id,
      label: s.label,
      ok: res.ok && diffs.length === 0,
      httpStatus: res.status,
      diffs,
      actual,
      latencyMs,
    };
  } catch (err) {
    return {
      id: s.id,
      label: s.label,
      ok: false,
      httpStatus: 0,
      diffs: [],
      actual: null,
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

function fmt(v: unknown, max = 80): string {
  const s = JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

async function main() {
  const samplesPath = join(ROOT, 'samples', 'SUST_Preli_Sample_Cases.json');
  const raw = JSON.parse(readFileSync(samplesPath, 'utf-8')) as { cases: SampleCase[] };
  const cases: SampleCase[] = raw.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    console.error('No cases found in samples JSON.');
    process.exit(1);
  }

  console.log(`\n🚀 Starting server on port ${PORT}...`);
  const server = startServer();
  const ready = await waitForHealth();
  if (!ready) {
    console.error('❌ Server did not become ready in time.');
    server.kill('SIGTERM');
    process.exit(1);
  }
  console.log('✅ Server is up.\n');
  console.log('─'.repeat(78));
  console.log(`Running ${cases.length} live sample cases against ${BASE_URL}/analyze-ticket`);
  console.log('─'.repeat(78));

  const results: RunResult[] = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    const status = r.ok ? '✅ PASS' : '❌ FAIL';
    console.log(`\n${status}  ${r.id}  HTTP ${r.httpStatus}  (${r.latencyMs}ms)  — ${r.label}`);
    if (r.error) {
      console.log(`   error: ${r.error}`);
    } else if (r.actual) {
      console.log(`   case_type=${fmt(r.actual['case_type'])}  department=${fmt(r.actual['department'])}  severity=${fmt(r.actual['severity'])}`);
      console.log(`   evidence_verdict=${fmt(r.actual['evidence_verdict'])}  relevant_tx=${fmt(r.actual['relevant_transaction_id'])}  confidence=${fmt(r.actual['confidence'])}`);
      console.log(`   human_review_required=${fmt(r.actual['human_review_required'])}`);
      console.log(`   customer_reply: ${fmt(r.actual['customer_reply'], 120)}`);
    }
    if (r.diffs.length > 0) {
      console.log(`   diffs:`);
      for (const d of r.diffs) console.log(`     ${d}`);
    }
  }

  console.log('\n' + '─'.repeat(78));
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\n📊 RESULT: ${passed}/${total} cases PASSED`);

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(`⏱  Latency: p50=${p50}ms, p95=${p95}ms`);

  console.log('\nPer-case status:');
  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.id}  HTTP ${r.httpStatus}  ${r.latencyMs}ms  ${r.label}`);
  }

  console.log(`\n${passed === total ? '🟢 STATUS: OK — all sample cases passed.' : `🟡 STATUS: ${total - passed} case(s) failed.`}`);

  server.kill('SIGTERM');
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

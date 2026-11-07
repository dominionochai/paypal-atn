import fs from 'node:fs';
import path from 'node:path';
import { SCENARIOS, reportPasses, runScenario } from './scenarios.js';
import type { ScenarioReport } from './scenarios.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const realtime = args.includes('--realtime');
  const names = args.filter((arg) => !arg.startsWith('--'));
  const selected = names.length === 0 || names.includes('all') ? SCENARIOS : SCENARIOS.filter((s) => names.includes(s.name));
  if (selected.length === 0) {
    console.error('Unknown scenario. Available: ' + SCENARIOS.map((s) => s.name).join(', ') + ', all');
    return 2;
  }
  const outDir = path.resolve('out');
  fs.mkdirSync(outDir, { recursive: true });
  let failed = false;
  for (const def of selected) {
    const started = Date.now();
    let report: ScenarioReport;
    try {
      report = await runScenario(def, { mode: live ? 'live' : 'mock', voucherDelayMs: realtime ? 100 : 0 });
    } catch (error) {
      console.error('\n[' + def.name + '] could not run: ' + (error instanceof Error ? error.message : String(error)));
      failed = true;
      continue;
    }
    console.log('\n=== ' + def.name + ' [' + report.model + '] ===');
    console.log(def.description);
    for (const check of report.checks) {
      const mark = check.ok ? 'PASS' : check.kind === 'outcome' && report.live ? 'INFO' : 'FAIL';
      console.log('  [' + mark + '] (' + check.kind + ') ' + check.name + ' - ' + check.detail);
    }
    for (const text of report.finalTexts) console.log('  agent: ' + text);
    const ok = reportPasses(report);
    console.log('  => ' + (ok ? 'PASS' : 'FAIL') + ' in ' + String(Date.now() - started) + ' ms');
    fs.writeFileSync(path.join(outDir, def.name + '.json'), JSON.stringify({ ...report, ok }, null, 2));
    if (!ok) failed = true;
  }
  console.log('\nTranscripts written to ' + outDir);
  return failed ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; },
);

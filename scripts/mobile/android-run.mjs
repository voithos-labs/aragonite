// Runs every Android row, then the probes, each on a freshly loaded harness page, and writes
// `result.json` to the out dir. Exits 1 when any row fails; a probe never fails the run.
// Usage: node android-run.mjs <out dir>, with Chrome open and port 9222 forwarded.
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createDevice, sleep } from './android-device.mjs';
import { probes, rows } from './android-rows.mjs';

const out = process.argv[2];
const device = createDevice(out);
const page = await device.connect();

// A reload, then the document: every row starts from a page no earlier row touched. A seed that
// didn't take is tried once more on a new reload, then fails the row with that as its reason.
async function fresh(source) {
	for (let attempt = 1; attempt <= 2; attempt++) {
		await page.evaluate('location.reload()').catch(() => {});
		await sleep(1000);
		for (let i = 0; i < 120; i++) {
			if (await page.evaluate('!!window.__test').catch(() => false)) break;
			await sleep(500);
		}
		await page.evaluate(`window.__test.setSource(${JSON.stringify(source)})`).catch(() => {});
		for (let i = 0; i < 20; i++) {
			if ((await page.evaluate('window.__test.getSource()').catch(() => null)) === source) return;
			await sleep(250);
		}
	}
	throw new Error('the seeded document never applied, after two page loads');
}

const ctx = { device, page, out, fresh };
const result = { platform: 'android', rows: [], probes: [] };
for (const [name, run] of Object.entries(rows)) {
	const started = Date.now();
	const row = await run(ctx).catch((error) => ({ reasons: [String(error?.stack ?? error)] }));
	result.rows.push({ ...row, name, pass: row.reasons.length === 0, ms: Date.now() - started });
}
for (const [name, run] of Object.entries(probes)) {
	const outcome = await run(ctx).catch((error) => ({ error: String(error?.stack ?? error) }));
	result.probes.push({ ...outcome, name });
}
page.close();

writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
const lines = result.rows.map(
	(row) =>
		`- ${row.pass ? 'PASS' : 'FAIL'} ${row.name}${row.pass ? '' : `: ${row.reasons.join('; ')}`}`
);
const summary = `### Android rows\n\n${lines.join('\n')}\n\n`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
process.exit(result.rows.every((row) => row.pass) ? 0 : 1);

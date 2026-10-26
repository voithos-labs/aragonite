#!/usr/bin/env node
// A release step: runs every e2e row marked `test.fixme(condition, '#<issue>: ...')` on each
// engine, as if unmarked, and lists the rows that now pass, so a fixed bug's row gets un-fixme'd.
// It never edits a spec. Builds the app on `E2E_PORT` like any Playwright run; the release
// checklist names it. `npm run release:fixme-recheck`, same in bash and PowerShell.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ENGINES = ['chromium', 'firefox', 'webkit'];
const SPECS = 'src/lib/e2e/tests';
// The annotation `src/lib/e2e/fixme-rerun.ts` records on a fixme row it ran anyway.
const FIXME_RERUN = 'fixme-rerun';
const PLAYWRIGHT = createRequire(import.meta.url).resolve('@playwright/test/cli');

/** @typedef {{ row: string, reason: string, passed: string[], failed: string[] }} FixmeRow */

const specs = readdirSync(SPECS, { recursive: true, withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
	.map((entry) => path.join(entry.parentPath, entry.name).replaceAll('\\', '/'))
	.filter((file) => /\btest\.fixme\(/.test(readFileSync(file, 'utf8')))
	.sort();
if (specs.length === 0) {
	console.log('fixme-recheck: no spec marks a row fixme');
	process.exit(0);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'fixme-recheck-'));
/** @type {Map<string, FixmeRow>} */
const rows = new Map();
const broken = [];
try {
	for (const engine of ENGINES) {
		const report = path.join(scratch, `${engine}.json`);
		console.log(`fixme-recheck: ${engine}, ${specs.length} spec files`);
		spawnSync(process.execPath, [PLAYWRIGHT, 'test', ...specs, '--reporter=json'], {
			env: {
				...process.env,
				ENGINE: engine,
				E2E_RERUN_FIXME: '1',
				PLAYWRIGHT_JSON_OUTPUT_NAME: report
			},
			stdio: ['ignore', 'ignore', 'inherit']
		});
		try {
			collect(engine, JSON.parse(readFileSync(report, 'utf8')));
		} catch (error) {
			broken.push(`${engine}: no report (${String(error)})`);
		}
	}
} finally {
	rmSync(scratch, { recursive: true, force: true });
}

const all = [...rows.values()];
const passing = all.filter((row) => row.failed.length === 0);
console.log(
	`\nfixme-recheck: ${all.length} fixme rows ran, ${passing.length} pass wherever marked`
);
for (const row of all) {
	const verdict =
		row.failed.length === 0
			? `passes on ${row.passed.join(', ')}; un-fixme it if its issue is fixed`
			: `fails on ${row.failed.join(', ')}` +
				(row.passed.length > 0 ? `, passes on ${row.passed.join(', ')}` : '');
	console.log(`  ${row.row}\n    ${row.reason}\n    ${verdict}`);
}
if (broken.length > 0 || all.length === 0) {
	console.error(
		'fixme-recheck: ' +
			(broken.length > 0
				? broken.join('; ')
				: `no row recorded ${FIXME_RERUN}; does src/lib/e2e/fixme-rerun.ts still run fixme rows?`)
	);
	process.exit(1);
}

/**
 * Records every test in one engine's Playwright JSON report whose fixme fired there.
 * @param {string} engine
 * @param {any} report
 */
function collect(engine, report) {
	const visit = (/** @type {any} */ suite) => {
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) {
				const annotations = [
					...(test.annotations ?? []),
					...(test.results ?? []).flatMap((/** @type {any} */ result) => result.annotations ?? [])
				];
				const mark = annotations.find((annotation) => annotation.type === FIXME_RERUN);
				if (!mark) continue;
				const key = `${SPECS}/${spec.file}:${spec.line} ${spec.title}`;
				const row = rows.get(key) ?? { row: key, reason: mark.description, passed: [], failed: [] };
				row[test.status === 'expected' ? 'passed' : 'failed'].push(engine);
				rows.set(key, row);
			}
		}
		(suite.suites ?? []).forEach(visit);
	};
	(report.suites ?? []).forEach(visit);
}

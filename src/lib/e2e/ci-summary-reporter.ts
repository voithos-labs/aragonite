import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

/**
 * Writes a GitHub job's e2e counts and failing tests to its job summary, and the same rows as
 * `test-results/ci-summary.json` for the job's artifact. Counts are per test, not per attempt, so
 * a retried test counts once, under its final outcome. A shard cut by `scripts/ci/e2e-shards.mjs`
 * names itself in `E2E_SHARD` and carries its plan from `E2E_SHARD_PLAN`, which the census reads.
 */

interface Row {
	project: string;
	location: string;
	title: string;
	error: string;
}

const LISTED_FAILURES = 200;

class CiSummaryReporter implements Reporter {
	private suite: Suite | undefined;
	private shard = '';

	onBegin(config: FullConfig, suite: Suite): void {
		this.suite = suite;
		if (config.shard) this.shard = ` shard ${config.shard.current}/${config.shard.total}`;
		else if (process.env.E2E_SHARD) this.shard = ` shard ${process.env.E2E_SHARD}`;
	}

	onEnd(): void {
		const tests = this.suite?.allTests() ?? [];
		const counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, retried: 0 };
		const failures: Row[] = [];
		const skipReasons = new Map<string, number>();
		// Seconds per spec file, what the next shard split is sized from.
		const fileSeconds = new Map<string, number>();
		for (const test of tests) {
			const spent = test.results.reduce((sum, result) => sum + result.duration, 0) / 1000;
			const spec = specPath(test);
			fileSeconds.set(spec, (fileSeconds.get(spec) ?? 0) + spent);
			const outcome = test.outcome();
			if (outcome === 'expected') counts.passed++;
			else if (outcome === 'unexpected') counts.failed++;
			else if (outcome === 'flaky') counts.flaky++;
			else counts.skipped++;
			if (test.results.length > 1) counts.retried++;
			if (outcome === 'unexpected') failures.push(row(test));
			if (outcome === 'skipped') {
				const reason = skipReason(test);
				skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
			}
		}
		const engine = process.env.ENGINE ?? 'chromium';
		const file = path.join('test-results', 'ci-summary.json');
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify(
				{
					engine,
					shard: this.shard.trim(),
					counts,
					failures,
					skipReasons: [...skipReasons],
					fileSeconds: [...fileSeconds].map(([spec, s]) => [spec, Math.round(s)]),
					plan: process.env.E2E_SHARD_PLAN
						? JSON.parse(readFileSync(process.env.E2E_SHARD_PLAN, 'utf8'))
						: null
				},
				null,
				1
			)
		);

		const lines = [
			`### e2e ${engine}${this.shard}`,
			'',
			'| passed | failed | flaky | skipped | retried |',
			'| --- | --- | --- | --- | --- |',
			`| ${counts.passed} | ${counts.failed} | ${counts.flaky} | ${counts.skipped} | ${counts.retried} |`,
			''
		];
		if (failures.length > 0) {
			lines.push('<details><summary>Failed tests</summary>', '');
			for (const failure of failures.slice(0, LISTED_FAILURES)) {
				lines.push(
					`- \`${failure.project}\` ${failure.location} ${failure.title}: ${failure.error}`
				);
			}
			if (failures.length > LISTED_FAILURES) {
				lines.push(`- and ${failures.length - LISTED_FAILURES} more in ci-summary.json`);
			}
			lines.push('', '</details>', '');
		}
		appendFileSync(process.env.GITHUB_STEP_SUMMARY!, lines.join('\n') + '\n');
	}
}

function row(test: TestCase): Row {
	const last: TestResult | undefined = test.results.at(-1);
	const message = last?.error?.message ?? last?.errors[0]?.message ?? '';
	return {
		project: test.parent.project()?.name ?? '',
		location: `${specPath(test)}:${test.location.line}`,
		title: test.titlePath().slice(3).join(' > '),
		// The first line only, colour codes stripped, so one failure stays one summary line.
		error: (stripVTControlCharacters(message).split('\n')[0] ?? '').slice(0, 200)
	};
}

function specPath(test: TestCase): string {
	return path.relative('src/lib/e2e/tests', test.location.file).replaceAll('\\', '/');
}

function skipReason(test: TestCase): string {
	const annotations = [...test.annotations, ...(test.results.at(-1)?.annotations ?? [])];
	const annotation = annotations.find((a) => a.type === 'skip' || a.type === 'fixme');
	return annotation ? `${annotation.type}: ${annotation.description ?? ''}` : 'skip: (no reason)';
}

export default CiSummaryReporter;

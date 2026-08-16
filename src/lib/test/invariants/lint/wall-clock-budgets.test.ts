/**
 * G4.48 — outside the perf projects, a scan's cost is priced as a growth RATIO through
 * `test/harness/scan-growth.ts`, never as an absolute wall-clock budget. A millisecond ceiling
 * measures the machine: it flakes on a loaded CI box and passes a real quadratic regression on a
 * fast one. The perf projects are exempt because a measured budget is exactly what they gate on.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { collectEditorSources } from './scan-source';

/**
 * Files permitted a wall-clock read, each with the reason no growth ratio can carry its claim.
 * A new reason inside an allowlisted file is reviewed against these, not waved through.
 */
const ALLOWLIST: Record<string, string> = {
	// The sanctioned instrument itself.
	'src/lib/test/harness/scan-growth.ts': 'the ratio harness — the clock reads that replace budgets',
	// Bounded by call-stack depth rather than scan length, so there is no N-vs-4N pair to price;
	// the exact assertion is core/inline/image-dimensions.test.ts and the clock is its backstop.
	'src/lib/test/core/inline/scan/gfm-autolinks.test.ts':
		'deep-nesting overflow guard: the bound is recursion depth, not scan length',
	// Elapsed time IS the oracle: a frozen main thread still lands every keystroke eventually,
	// so only the clock separates a scan that left the main thread from one that did not.
	'src/lib/e2e/tests/search/pathological-regex.spec.ts':
		'main-thread responsiveness while a worker scan runs — a ratio cannot express it'
};

/** The suites the rule binds; the perf projects gate on measured budgets by design. */
const SUITE_ROOTS = ['src/lib/test', 'src/lib/e2e'];
const PERF_DIRS = ['src/lib/test/perf/', 'src/lib/e2e/tests/perf/'];

const WALL_CLOCK_RE = /\b(?:performance\.now|Date\.now)\s*\(/;

function findWallClockReads(sources: { relPath: string; code: string }[]): string[] {
	return sources
		.filter((f) => !PERF_DIRS.some((dir) => f.relPath.startsWith(dir)))
		.filter((f) => WALL_CLOCK_RE.test(f.code))
		.map((f) => f.relPath);
}

describe('G4.48 wall-clock budgets go through the growth harness', () => {
	const sources = SUITE_ROOTS.flatMap((root) =>
		collectEditorSources(path.resolve(root), { includeTests: true })
	);

	it('inspected the suite sources', () => {
		expect(sources.length).toBeGreaterThan(0);
	});

	it('every wall-clock read outside the perf projects is allowlisted', () => {
		const violations = findWallClockReads(sources).filter((relPath) => !(relPath in ALLOWLIST));
		expect(
			violations,
			'price the scan as a measureScanGrowth ratio, or allowlist the file with the reason no ratio carries its claim'
		).toEqual([]);
	});

	it('every allowlist entry still reads the clock (no dead allowlist)', () => {
		const live = new Set(findWallClockReads(sources));
		for (const relPath of Object.keys(ALLOWLIST)) {
			expect(live.has(relPath), `allowlist stale for ${relPath}`).toBe(true);
		}
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	// Assembled rather than written out, so this file is not its own violation.
	const clockRead = (host: string) => `const t = ${host}.now();`;

	it('matcher flags both clock sources and passes a blanked comment', () => {
		const flagged = findWallClockReads([
			{ relPath: 'a.test.ts', code: clockRead('performance') },
			{ relPath: 'b.test.ts', code: clockRead('Date') },
			{ relPath: 'c.test.ts', code: '   ' }
		]);
		expect(flagged).toEqual(['a.test.ts', 'b.test.ts']);
	});

	it('matcher exempts the perf projects by path', () => {
		expect(
			findWallClockReads([
				{ relPath: 'src/lib/e2e/tests/perf/x.perf.spec.ts', code: clockRead('performance') },
				{ relPath: 'src/lib/test/perf/y.bench.ts', code: clockRead('performance') }
			])
		).toEqual([]);
	});
});

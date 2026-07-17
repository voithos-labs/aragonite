/**
 * G4.17 — perf spec glob partition. Every `*.spec.ts` under `src/lib/e2e/tests/perf/`
 * must be collected by one of two Playwright projects: `e2e-vr`, whose testMatch is
 * a `vr-` prefixed `.spec.ts`, or `e2e-perf` / `e2e-perf-prod`, whose testMatch is a
 * `.perf.spec.ts` suffix. A perf spec whose basename matches neither shape runs in
 * NO project — it is silently never executed. This lint fails the day such a file is
 * born, instead of at the next time someone notices the coverage hole.
 *
 * Helper `.ts` files (harnesses, fixtures) are not `.spec.ts`, so Playwright never
 * collects them as tests; only `.spec.ts` basenames are partitioned here.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const PERF_DIR = path.resolve('src/lib/e2e/tests/perf');

/** Collected by `e2e-vr` (`perf/vr-*.spec.ts`). */
function matchesVr(basename: string): boolean {
	return basename.startsWith('vr-') && basename.endsWith('.spec.ts');
}

/** Collected by `e2e-perf` / `e2e-perf-prod` (the `.perf.spec.ts` suffix). */
function matchesPerf(basename: string): boolean {
	return basename.endsWith('.perf.spec.ts');
}

function specBasenames(): string[] {
	return readdirSync(PERF_DIR)
		.filter((name) => name.endsWith('.spec.ts'))
		.sort();
}

describe('G4.17 perf spec glob partition', () => {
	const specs = specBasenames();

	it('found perf spec files to partition', () => {
		expect(specs.length).toBeGreaterThan(0);
	});

	it('every perf spec is collected by e2e-vr or e2e-perf (no orphans)', () => {
		const orphans = specs.filter((name) => !matchesVr(name) && !matchesPerf(name));
		expect(
			orphans,
			`perf specs matching no Playwright project (neither vr-*.spec.ts nor *.perf.spec.ts): ${orphans.join(', ')}`
		).toEqual([]);
	});

	// Non-vacuity: the partition proves something only if both shapes are present —
	// a rule covering an empty class passes trivially.
	it('the perf dir holds at least one spec of each shape', () => {
		expect(specs.some(matchesVr), 'no vr-*.spec.ts present').toBe(true);
		expect(specs.some(matchesPerf), 'no *.perf.spec.ts present').toBe(true);
	});
});

describe('G4.17 perf spec glob partition — classifier self-tests', () => {
	it('classifies the two live shapes and rejects an orphan', () => {
		expect(matchesVr('vr-windowing.spec.ts')).toBe(true);
		expect(matchesPerf('typing-latency.perf.spec.ts')).toBe(true);
		expect(matchesVr('orphan.spec.ts')).toBe(false);
		expect(matchesPerf('orphan.spec.ts')).toBe(false);
	});
});

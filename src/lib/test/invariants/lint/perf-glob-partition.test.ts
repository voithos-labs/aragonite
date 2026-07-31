/**
 * G4.17 — every `*.spec.ts` under the perf dir is collected by `e2e-vr` or by
 * `e2e-perf` / `e2e-perf-prod`; one matching neither runs in NO project, since `e2e-top`
 * ignores `perf/**` outright. Classification is by path relative to the perf dir, not
 * basename, because `*` does not cross a `/` while `**` matches any depth — so a nested
 * `vr/vr-x.spec.ts` reads as a vr spec while being collected by nothing.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const PERF_DIR = path.resolve('src/lib/e2e/tests/perf');

/** Collected by `e2e-vr` (`perf/vr-*.spec.ts` — top level only). */
function matchesVr(relPath: string): boolean {
	return !relPath.includes('/') && relPath.startsWith('vr-') && relPath.endsWith('.spec.ts');
}

/** Collected by `e2e-perf` / `e2e-perf-prod` (the `.perf.spec.ts` suffix, any depth). */
function matchesPerf(relPath: string): boolean {
	return relPath.endsWith('.perf.spec.ts');
}

/** Every spec under the perf dir, as a posix path relative to it. */
function specPaths(): string[] {
	const found: string[] = [];
	function walk(dir: string, prefix: string): void {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
			else if (entry.name.endsWith('.spec.ts')) found.push(prefix + entry.name);
		}
	}
	walk(PERF_DIR, '');
	return found.sort();
}

describe('G4.17 perf spec glob partition', () => {
	const specs = specPaths();

	it('found perf spec files to partition', () => {
		expect(specs.length).toBeGreaterThan(0);
	});

	it('every perf spec is collected by e2e-vr or e2e-perf (no orphans)', () => {
		const orphans = specs.filter((name) => !matchesVr(name) && !matchesPerf(name));
		expect(
			orphans,
			`perf specs matching no Playwright project (neither a top-level vr-*.spec.ts nor a *.perf.spec.ts at any depth): ${orphans.join(', ')}`
		).toEqual([]);
	});

	// Non-vacuity: a rule covering an empty class passes trivially.
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

	// The depth cases a basename-only classifier gets wrong: `e2e-vr` cannot reach a
	// subdirectory, `e2e-perf` reaches every depth.
	it('classifies by depth, not basename', () => {
		expect(matchesVr('vr/vr-windowing.spec.ts')).toBe(false);
		expect(matchesPerf('vr/vr-windowing.spec.ts')).toBe(false);
		expect(matchesPerf('nested/typing-latency.perf.spec.ts')).toBe(true);
	});
});

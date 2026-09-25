/**
 * G4.17: no spec file runs in two Playwright projects, read from what Playwright lists rather
 * than from a copy of the config's globs. A spec no project collects is the lockstep lint's
 * catch (every spec lists a test). The WebKit lane re-runs a slice of the tree in a second
 * engine, so it never counts as a second project.
 */
import { describe, it, expect } from 'vitest';
import { listPlaywrightTests, type ListedTest } from './playwright-list';

const SECOND_ENGINE = 'e2e-webkit';

/** Each listed spec file whose projects break the partition, with the projects that list it. */
export function partitionBreaks(tests: readonly ListedTest[]): string[] {
	const projectsByFile = new Map<string, Set<string>>();
	for (const test of tests) {
		const projects = projectsByFile.get(test.file) ?? new Set<string>();
		projects.add(test.project);
		projectsByFile.set(test.file, projects);
	}
	return [...projectsByFile]
		.filter(([, projects]) => [...projects].filter((p) => p !== SECOND_ENGINE).length > 1)
		.map(([file, projects]) => `${file} (${[...projects].sort().join(', ')})`)
		.sort();
}

describe('G4.17 no spec runs in two Playwright projects', () => {
	const { tests } = listPlaywrightTests();

	it('listed the perf specs of both shapes, so the partition is read over them', () => {
		const files = new Set(tests.map((test) => test.file));
		expect([...files].some((file) => /^perf\/vr-[^/]*\.spec\.ts$/.test(file))).toBe(true);
		expect([...files].some((file) => file.endsWith('.perf.spec.ts'))).toBe(true);
	});

	it('no spec runs in two first-engine projects', () => {
		expect(partitionBreaks(tests)).toEqual([]);
	});
});

describe('G4.17 partition self-tests', () => {
	const row = (file: string, project: string): ListedTest => ({
		project,
		file,
		title: 't',
		line: 1,
		column: 1
	});

	it('reports a spec two projects collect, and spares the WebKit lane re-running one', () => {
		expect(
			partitionBreaks([
				row('perf/vr-a.spec.ts', 'e2e-vr'),
				row('perf/vr-a.spec.ts', 'e2e-perf'),
				row('smoke.spec.ts', 'e2e-top'),
				row('smoke.spec.ts', SECOND_ENGINE),
				row('webkit/paste.spec.ts', SECOND_ENGINE)
			])
		).toEqual(['perf/vr-a.spec.ts (e2e-perf, e2e-vr)']);
	});
});

/**
 * The file scan's own probes, run once here rather than in every rule table: a match outside
 * the allowlist is a violation, an allowed file is not, a stale entry and an unreached file each
 * red, the population bounds the scan, and a token inside a comment cannot trip it.
 */

import { describe, it, expect } from 'vitest';
import { probeFile, runFileRule, svelteOnly, under, type FileRule } from './file-rule';

const RULE: FileRule = {
	id: 'probe rule',
	matches: /\bforbidden\s*\(/,
	allowed: { 'src/lib/allowed.ts': 'the one caller' },
	reason: 'forbidden() outside its allowlist',
	hits: [],
	misses: []
};

const file = (relPath: string, code: string) => probeFile({ relPath, code });

describe('the file scan', () => {
	it('flags a match outside the allowlist and spares the allowed file', () => {
		const report = runFileRule(RULE, [
			file('src/lib/rogue.ts', 'forbidden(x);'),
			file('src/lib/allowed.ts', 'forbidden(y);'),
			file('src/lib/clean.ts', 'permitted(z);')
		]);
		expect(report.violations).toEqual(['src/lib/rogue.ts']);
		expect(report.stale).toEqual([]);
		expect(report.population).toBe(3);
	});

	it('reports an allowlist entry that no longer matches', () => {
		expect(runFileRule(RULE, [file('src/lib/allowed.ts', 'permitted(y);')]).stale).toEqual([
			'src/lib/allowed.ts'
		]);
	});

	it('a token inside a comment cannot trip the scan', () => {
		expect(runFileRule(RULE, [file('src/lib/x.ts', '// forbidden(x) would be wrong')])).toEqual({
			violations: [],
			stale: ['src/lib/allowed.ts'],
			unreached: [],
			population: 1
		});
	});

	it('the population bounds both the violations and the dead-entry check', () => {
		const scoped: FileRule = { ...RULE, population: svelteOnly };
		const report = runFileRule(scoped, [
			file('src/lib/a.ts', 'forbidden(x);'),
			file('src/lib/b.svelte', 'forbidden(x);')
		]);
		expect(report.violations).toEqual(['src/lib/b.svelte']);
		expect(report.stale).toEqual(['src/lib/allowed.ts']);
		expect(report.population).toBe(1);
	});

	it('names a file the population no longer reaches, and one the matcher no longer flags', () => {
		const rule: FileRule = {
			...RULE,
			population: under('src/lib/cursor/'),
			reaches: ['src/lib/cursor/walk.ts', 'src/lib/cursor/gone.ts'],
			mustMatch: ['src/lib/tree-operations/unshare.ts']
		};
		const report = runFileRule(rule, [
			file('src/lib/cursor/walk.ts', 'permitted();'),
			file('src/lib/tree-operations/unshare.ts', 'permitted();')
		]);
		expect(report.unreached).toEqual([
			'src/lib/cursor/gone.ts',
			'src/lib/tree-operations/unshare.ts'
		]);
	});

	it('a predicate matcher reads the file, not just its code', () => {
		const rule: FileRule = { ...RULE, matches: (f) => f.relPath.endsWith('.css') };
		expect(
			runFileRule(rule, [file('src/lib/a.css', ''), file('src/lib/a.ts', '')]).violations
		).toEqual(['src/lib/a.css']);
	});
});

/**
 * The per-call scan's own probes, run once here rather than in every rule table: a failing call
 * is keyed by its line, a declaration and a comment mention are never calls, an allowlist key
 * suppresses one call and reds once stale, and a call whose parens never close is a violation.
 */

import { describe, it, expect } from 'vitest';
import { runCallSiteRule, type CallSiteRule } from './call-site-rule';
import { probeFile } from './file-rule';

const RULE: CallSiteRule = {
	id: 'probe rule',
	calls: ['build', 'rebuild'],
	holds: (args) => /\bgrammar\b/.test(args),
	reason: 'a call without grammar',
	hits: [],
	misses: []
};

const file = (relPath: string, code: string) => probeFile({ relPath, code });

describe('the per-call scan', () => {
	it('keys a failing call by its line and names the callee', () => {
		const report = runCallSiteRule(RULE, [
			file('src/lib/a.ts', 'build(x, grammar);\n\nrebuild(y);\nother.build(z);')
		]);
		expect(report.violations).toEqual(['src/lib/a.ts:3  rebuild(y)']);
		expect(report.callers).toBe(1);
	});

	it('skips the declaration and a mention inside a comment', () => {
		const report = runCallSiteRule(RULE, [
			file('src/lib/a.ts', 'export function build(a, b) {}\n// build(x) would be wrong\n')
		]);
		expect(report.violations).toEqual([]);
		expect(report.callers).toBe(0);
	});

	it('an allowlist key suppresses that one call and reds once nothing fails there', () => {
		const rule: CallSiteRule = { ...RULE, allowed: { 'src/lib/a.ts:2': 'a stated exception' } };
		const failing = [file('src/lib/a.ts', 'build(x, grammar);\nbuild(y);')];
		expect(runCallSiteRule(rule, failing)).toEqual({ violations: [], stale: [], callers: 1 });
		const fixed = [file('src/lib/a.ts', 'build(x, grammar);\nbuild(y, grammar);')];
		expect(runCallSiteRule(rule, fixed).stale).toEqual(['src/lib/a.ts:2']);
	});

	it('reads past a paren inside a string or a regex literal, and reds an unclosed call', () => {
		const balanced = [file('src/lib/a.ts', "build(strip(a, /)/), ')', grammar);")];
		expect(runCallSiteRule(RULE, balanced).violations).toEqual([]);
		const unclosed = [file('src/lib/a.ts', 'build(x, grammar')];
		expect(runCallSiteRule(RULE, unclosed).violations).toEqual(['src/lib/a.ts:1  build(…)']);
	});

	it('hands the predicate the callee, so one rule can read each name differently', () => {
		const rule: CallSiteRule = { ...RULE, holds: (args, callee) => callee === 'rebuild' };
		const report = runCallSiteRule(rule, [file('src/lib/a.ts', 'build(x);\nrebuild(y);')]);
		expect(report.violations).toEqual(['src/lib/a.ts:1  build(x)']);
	});
});

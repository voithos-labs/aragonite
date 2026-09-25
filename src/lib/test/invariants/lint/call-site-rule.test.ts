/**
 * The per-call scan's own probes, run once here rather than in every rule table: a failing call
 * is keyed by its enclosing function, a declaration and a comment mention are never calls, an
 * allowlist key survives an edit above it and reds once stale, and an unclosed call is a violation.
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

const lines = (...parts: string[]) => parts.join('\n');

describe('the per-call scan', () => {
	it('keys a failing call by its enclosing function, with the line in the message', () => {
		const code = lines(
			'function f() {',
			'\tbuild(x, grammar);',
			'\trebuild(y);',
			'\tother.build(z);',
			'}'
		);
		const report = runCallSiteRule(RULE, [file('src/lib/a.ts', code)]);
		expect(report.violations).toEqual(['src/lib/a.ts :: f (line 3)  rebuild(y)']);
		expect(report.callers).toBe(1);
	});

	it('reports every failing call in one function, and a top-level call under <module>', () => {
		const code = lines('build(x);', 'const g = () => {', '\tbuild(y);', '\tbuild(z);', '};');
		expect(runCallSiteRule(RULE, [file('src/lib/a.ts', code)]).violations).toEqual([
			'src/lib/a.ts :: <module> (line 1)  build(x)',
			'src/lib/a.ts :: g (line 3)  build(y)',
			'src/lib/a.ts :: g (line 4)  build(z)'
		]);
	});

	it('skips the declaration and a mention inside a comment', () => {
		const code = lines('export function build(a, b) {}', '// build(x) would be wrong', '');
		const report = runCallSiteRule(RULE, [file('src/lib/a.ts', code)]);
		expect(report.violations).toEqual([]);
		expect(report.callers).toBe(0);
	});

	it('an allowlist key survives lines added above it and reds once nothing fails there', () => {
		const rule: CallSiteRule = { ...RULE, allowed: { 'src/lib/a.ts :: g': 'a stated exception' } };
		const body = lines('function g() {', '\tbuild(y);', '}');
		expect(runCallSiteRule(rule, [file('src/lib/a.ts', body)])).toEqual({
			violations: [],
			stale: [],
			callers: 1
		});
		const shifted = file('src/lib/a.ts', lines('const pad = 1;', '', body));
		expect(runCallSiteRule(rule, [shifted]).violations).toEqual([]);
		expect(runCallSiteRule(rule, [file('src/lib/b.ts', body)]).violations).toEqual([
			'src/lib/b.ts :: g (line 2)  build(y)'
		]);
		const fixed = file('src/lib/a.ts', lines('function g() {', '\tbuild(y, grammar);', '}'));
		expect(runCallSiteRule(rule, [fixed]).stale).toEqual(['src/lib/a.ts :: g']);
	});

	it('reads past a paren inside a string or a regex literal, and reds an unclosed call', () => {
		const balanced = [file('src/lib/a.ts', "build(strip(a, /)/), ')', grammar);")];
		expect(runCallSiteRule(RULE, balanced).violations).toEqual([]);
		const unclosed = [file('src/lib/a.ts', 'build(x, grammar')];
		expect(runCallSiteRule(RULE, unclosed).violations).toEqual([
			'src/lib/a.ts :: <module> (line 1)  build(…)'
		]);
	});

	it('hands the predicate the callee, so one rule can read each name differently', () => {
		const rule: CallSiteRule = { ...RULE, holds: (args, callee) => callee === 'rebuild' };
		const report = runCallSiteRule(rule, [file('src/lib/a.ts', 'build(x);\nrebuild(y);')]);
		expect(report.violations).toEqual(['src/lib/a.ts :: <module> (line 1)  build(x)']);
	});
});

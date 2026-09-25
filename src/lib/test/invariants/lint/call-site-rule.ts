/**
 * The shared per-call scan. A rule names the callees whose call sites it binds and a predicate
 * every call's argument text must satisfy; `describeCallSiteRules` runs a table of rules over one
 * source collection. A call whose parens never close is a violation: the scan could not read it.
 * An allowlist names a function, not a line, so an edit above the site leaves the entry valid.
 */

import { describe, it, expect } from 'vitest';
import { callSites, enclosingFunction, lexicalClasses, type SourceFile } from './scan-source';
import { probeFile, type Probe } from './file-rule';

export interface CallSiteRule {
	/** The G-number and the rule, as the describe title. */
	id: string;
	/** The files the rule binds; every file in the collection by default. */
	population?: (file: SourceFile) => boolean;
	/** The callees, by the names their callers spell them with. */
	calls: readonly string[];
	/** True when the call's argument text satisfies the rule. */
	holds: (args: string, callee: string) => boolean;
	/** Functions whose calls may fail, keyed `relPath :: function`, each with its reason; a key
	 *  with no failing call left fails. */
	allowed?: Record<string, string>;
	/** What a violation means, printed with the offending calls. */
	reason: string;
	/** The smallest number of files calling one of the names the rule is live over (default 1). */
	atLeastCallers?: number;
	hits: Probe[];
	misses: Probe[];
}

export interface CallSiteReport {
	/** `relPath :: function (line n)  callee(args)` per failing call. */
	violations: string[];
	stale: string[];
	callers: number;
}

function lineOf(code: string, index: number): number {
	return code.slice(0, index).split('\n').length;
}

export function runCallSiteRule(rule: CallSiteRule, sources: SourceFile[]): CallSiteReport {
	const allowed = rule.allowed ?? {};
	const violations: string[] = [];
	const failing = new Set<string>();
	let callers = 0;
	for (const file of sources.filter(rule.population ?? (() => true))) {
		let calls = 0;
		let classes: Uint8Array | undefined;
		for (const callee of rule.calls) {
			for (const site of callSites(file.code, callee)) {
				calls += 1;
				if (site.args !== null && rule.holds(site.args, callee)) continue;
				classes ??= lexicalClasses(file.code);
				const key = `${file.relPath} :: ${enclosingFunction(file.code, site.index, classes)}`;
				failing.add(key);
				if (key in allowed) continue;
				const line = lineOf(file.code, site.index);
				violations.push(`${key} (line ${line})  ${callee}(${site.args ?? '…'})`);
			}
		}
		if (calls > 0) callers += 1;
	}
	return {
		violations,
		stale: Object.keys(allowed).filter((key) => !failing.has(key)),
		callers
	};
}

function probeText(probe: Probe): string {
	return typeof probe === 'string' ? probe : `${probe.relPath}: ${probe.code}`;
}

export function describeCallSiteRules(rules: CallSiteRule[], sources: SourceFile[]): void {
	for (const rule of rules) {
		describe(rule.id, () => {
			const report = runCallSiteRule(rule, sources);

			it('found the call sites it binds', () => {
				expect(report.callers).toBeGreaterThanOrEqual(rule.atLeastCallers ?? 1);
			});

			it('every call satisfies the rule', () => {
				expect(report.violations, rule.reason).toEqual([]);
			});

			if (rule.allowed && Object.keys(rule.allowed).length > 0) {
				it('every allowlist entry still names a failing call (no dead entry)', () => {
					expect(report.stale).toEqual([]);
				});
			}

			it('the predicate flags every hit and spares every miss', () => {
				for (const hit of rule.hits) {
					expect(runCallSiteRule(rule, [probeFile(hit)]).violations, probeText(hit)).not.toEqual(
						[]
					);
				}
				for (const miss of rule.misses) {
					expect(runCallSiteRule(rule, [probeFile(miss)]).violations, probeText(miss)).toEqual([]);
				}
			});
		});
	}
}

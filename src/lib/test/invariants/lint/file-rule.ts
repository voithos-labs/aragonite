/**
 * The shared per-file scan. A rule names the files it binds, the shape that counts as a
 * violation, and the files allowed to hold it; `describeFileRules` runs a table of rules over one
 * source collection and checks each rule's own probe snippets through the same scan. A manifest
 * (a declared list of files) is the same scan with a complete allowlist, read in both directions.
 */

import { describe, it, expect } from 'vitest';
import { stripComments, type SourceFile } from './scan-source';

/** A snippet the matcher must flag or spare; a plain string scans as `probe.ts`. */
export type Probe = string | { relPath: string; code: string };

export interface FileRule {
	/** The G-number and the rule, as the describe title. */
	id: string;
	/** The files the rule binds; every file in the collection by default. */
	population?: (file: SourceFile) => boolean;
	/** A file in the population that matches is a violation, unless `allowed` names it. */
	matches: RegExp | ((file: SourceFile) => boolean);
	/** Files that may match, each with its reason; an entry that no longer matches fails. */
	allowed?: Record<string, string>;
	/** What a violation means, printed with the offending paths. */
	reason: string;
	/** Files the population must hold, so a moved file cannot leave the rule scanning nothing. */
	reaches?: string[];
	/** Files the matcher must flag whether or not the population holds them: proof it reads code. */
	mustMatch?: string[];
	/** The smallest population the rule is live over (default 1). */
	atLeast?: number;
	hits: Probe[];
	misses: Probe[];
}

/** A rule pinning the matching files to a declared list, both directions. */
export interface ManifestRule {
	id: string;
	population?: (file: SourceFile) => boolean;
	matches: RegExp | ((file: SourceFile) => boolean);
	/** Every file that matches, with its role. */
	declared: Record<string, string>;
	reason: string;
	reaches?: string[];
	hits: Probe[];
	misses: Probe[];
}

export interface FileRuleReport {
	violations: string[];
	stale: string[];
	unreached: string[];
	population: number;
}

// ── Population helpers ───────────────────────────────────────────────────────

export const under =
	(...prefixes: string[]) =>
	(file: SourceFile): boolean =>
		prefixes.some((prefix) => file.relPath.startsWith(prefix));

export const notUnder =
	(...prefixes: string[]) =>
	(file: SourceFile): boolean =>
		!prefixes.some((prefix) => file.relPath.startsWith(prefix));

export const except =
	(...relPaths: string[]) =>
	(file: SourceFile): boolean =>
		!relPaths.includes(file.relPath);

export const svelteOnly = (file: SourceFile): boolean => file.relPath.endsWith('.svelte');

// ── The scan ─────────────────────────────────────────────────────────────────

function matcherOf(rule: Pick<FileRule, 'matches'>): (file: SourceFile) => boolean {
	const { matches } = rule;
	return matches instanceof RegExp ? (file) => matches.test(file.code) : matches;
}

export function runFileRule(rule: FileRule, sources: SourceFile[]): FileRuleReport {
	const matches = matcherOf(rule);
	const inPopulation = rule.population ?? (() => true);
	const allowed = rule.allowed ?? {};
	const population = sources.filter(inPopulation);
	const matching = new Set(population.filter(matches).map((file) => file.relPath));
	const reached = new Set(population.map((file) => file.relPath));
	const unmatched = (rule.mustMatch ?? []).filter((relPath) => {
		const file = sources.find((f) => f.relPath === relPath);
		return file === undefined || !matches(file);
	});
	return {
		violations: [...matching].filter((relPath) => !(relPath in allowed)).sort(),
		stale: Object.keys(allowed).filter((relPath) => !matching.has(relPath)),
		unreached: [...(rule.reaches ?? []).filter((relPath) => !reached.has(relPath)), ...unmatched],
		population: population.length
	};
}

export function probeFile(probe: Probe): SourceFile {
	const { relPath, code } =
		typeof probe === 'string' ? { relPath: 'probe.ts', code: probe } : probe;
	return { relPath, text: code, code: stripComments(code) };
}

function probeText(probe: Probe): string {
	return typeof probe === 'string' ? probe : `${probe.relPath}: ${probe.code}`;
}

function describeProbes(rule: FileRule): void {
	it('the matcher flags every hit and spares every miss', () => {
		for (const hit of rule.hits) {
			expect(runFileRule(rule, [probeFile(hit)]).violations, probeText(hit)).not.toEqual([]);
		}
		for (const miss of rule.misses) {
			expect(runFileRule(rule, [probeFile(miss)]).violations, probeText(miss)).toEqual([]);
		}
	});
}

export function describeFileRules(rules: FileRule[], sources: SourceFile[]): void {
	for (const rule of rules) {
		describe(rule.id, () => {
			const report = runFileRule(rule, sources);

			it('reaches the files it binds', () => {
				expect(report.population).toBeGreaterThanOrEqual(rule.atLeast ?? 1);
				expect(report.unreached).toEqual([]);
			});

			it('no file outside the allowlist matches', () => {
				expect(report.violations, rule.reason).toEqual([]);
			});

			if (rule.allowed && Object.keys(rule.allowed).length > 0) {
				it('every allowlist entry still matches (no dead entry)', () => {
					expect(report.stale).toEqual([]);
				});
			}

			describeProbes(rule);
		});
	}
}

export function describeManifests(rules: ManifestRule[], sources: SourceFile[]): void {
	for (const rule of rules) {
		const asFileRule: FileRule = { ...rule, allowed: rule.declared };
		describe(rule.id, () => {
			const report = runFileRule(asFileRule, sources);

			it('the matching files are exactly the declared ones', () => {
				expect({ undeclared: report.violations, stale: report.stale }, rule.reason).toEqual({
					undeclared: [],
					stale: []
				});
				expect(report.unreached).toEqual([]);
			});

			describeProbes(asFileRule);
		});
	}
}

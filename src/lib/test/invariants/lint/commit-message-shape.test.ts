/**
 * G4.58 — one commit-message rule, two doors: `scripts/lint-commit-message.mjs` holds the only
 * definition of the enforced shape, and both the `commit-msg` hook and the CI step over a pull
 * request's range call it. Documented-only, the rule drifted to a 1,499-character subject.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
	commitMessageProblems,
	SUBJECT_LIMIT
} from '../../../../../scripts/lint-commit-message.mjs';

const ROOT = path.resolve('.');

function rulesFor(message: string): string[] {
	return commitMessageProblems(message).map((problem) => problem.rule);
}

const LEGAL: [name: string, message: string][] = [
	['a scoped subject', '+ (editor) block parser'],
	['an unscoped subject', '! caret lands at a hidden marker'],
	['a multi-scope subject', '@ (docs,plugins) the guide names the freeze contract'],
	['a subject at exactly the limit', `~ ${'x'.repeat(SUBJECT_LIMIT - 2)}`],
	[
		'per-change lines after the summary',
		'> (schema) two registries merge\n\n+ (schema) the opener registry\n- (core) the kind branch'
	],
	[
		'a three-line prose body',
		'~ (undo) the typing batch window widens\n\nbreaking: consumers pinning the old\nwindow read one entry where they\nread three before'
	],
	['a merge commit', "Merge branch 'dev' into main"],
	['a revert', 'Revert "+ (editor) block parser"'],
	['a dependabot bump', 'Bump vite from 8.2.1 to 8.2.2'],
	[
		'a grouped dependabot bump',
		'Bump the development-minor-patch group across 1 directory with 6 updates'
	],
	// dependabot-core capitalizes `Bump` only because our prefix is nil; a configured prefix
	// lowercases it, and the history carries one.
	['a lowercase dependabot bump', 'bump actions/checkout from 7 to 8'],
	['a dependabot build scope', 'build(deps): bump actions/checkout from 7 to 8'],
	['a fixup commit', 'fixup! + (editor) block parser'],
	['a squash commit', 'squash! + (editor) block parser'],
	['an identifier opening the subject', '+ (invariants) G1.38 pins the splice belt'],
	['an acronym opening the subject', '~ (core) CST nodes carry child spans'],
	['a camel-case name opening the subject', '! (cursor) MeasurableChild reads the gap'],
	['a product name opening the subject', '+ (e2e) WebKit lane runs per release'],
	[
		'git comment lines and trailing blanks',
		'+ (editor) block parser\n\n# Please enter the commit message for your changes.\n#\n\n'
	]
];

/** One failing example per rule; `line` pins which line the rule is reported against. */
const ILLEGAL: [rule: string, line: number, message: string][] = [
	['subject-missing', 1, ''],
	['subject-missing', 1, '# Please enter the commit message for your changes.\n'],
	['subject-too-long', 1, `~ ${'x'.repeat(SUBJECT_LIMIT - 1)}`],
	['subject-shape', 1, 'fixed the caret at a hidden marker'],
	['subject-shape', 1, '? (editor) block parser'],
	['subject-shape', 1, '+ (Editor) block parser'],
	['subject-shape', 1, '~(deps-dev): Bump the development-minor-patch group with 6 updates'],
	['subject-shape', 1, '+ Fixed the caret at a hidden marker'],
	['subject-shape', 1, '+ (editor) Fixed the caret at a hidden marker'],
	['subject-shape', 1, '+ (editor) A caret lands at a hidden marker'],
	['subject-trailing-period', 1, '+ (editor) block parser.'],
	['body-missing-blank-line', 2, '+ (editor) undo/redo\n! (editor) editable when empty'],
	['subject-too-long', 3, `> (schema) two registries merge\n\n+ (schema) ${'x'.repeat(70)}`],
	[
		'body-too-many-lines',
		3,
		'~ (undo) the batch window widens\n\none line\ntwo lines\nthree lines\nfour lines'
	],
	['body-line-too-long', 3, `~ (undo) the batch window widens\n\n${'x'.repeat(101)}`],
	[
		'attribution-trailer',
		3,
		'+ (editor) block parser\n\nCo-Authored-By: Somebody <nobody@example.com>'
	],
	['attribution-trailer', 3, '+ (editor) block parser\n\n🤖 Generated with [Claude Code]']
];

describe('G4.58 commit-message shape — the rule', () => {
	it('scans a corpus of both verdicts rather than passing vacuously', () => {
		expect(LEGAL.length).toBeGreaterThan(5);
		expect(new Set(ILLEGAL.map(([rule]) => rule)).size).toBeGreaterThan(5);
	});

	it.each(LEGAL)('accepts %s', (_name, message) => {
		expect(commitMessageProblems(message)).toEqual([]);
	});

	it.each(ILLEGAL)('rejects with %s at line %i', (rule, line, message) => {
		const problems = commitMessageProblems(message);
		expect(problems.map((problem) => `${problem.rule}@${problem.line}`)).toContain(
			`${rule}@${line}`
		);
	});

	// A body mixing symbol lines with prose is prose: the relaxed per-change allowance is for
	// the shape where EVERY body line is a change line.
	it('reads a mixed body as prose, not as per-change lines', () => {
		const mixed =
			'> (schema) two registries merge\n\n+ (schema) the opener registry\nand a note\nand another\nand a fourth';
		expect(rulesFor(mixed)).toContain('body-too-many-lines');
	});
});

describe('G4.58 commit-message shape — the two doors', () => {
	const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
	const unitJob = ci.slice(ci.indexOf('\n  unit:'), ci.indexOf('\n  e2e:'));

	it('the prepare script points git at the tracked hooks directory', () => {
		expect(pkg.scripts.prepare).toMatch(/git config core\.hooksPath \.githooks/);
	});

	it('the commit-msg hook exists and calls the one script', () => {
		const hook = path.join(ROOT, '.githooks/commit-msg');
		expect(existsSync(hook)).toBe(true);
		expect(readFileSync(hook, 'utf8')).toContain('lint-commit-message.mjs');
	});

	// The range is the PR's OWN commits, and the release PR is scoped out: dev into main would
	// otherwise range over every commit on dev and read red on history nobody in it wrote.
	it('the unit job lints only the commits a pull request adds, never the release PR', () => {
		expect(unitJob).toMatch(/lint-commit-message\.mjs --range HEAD\^1\.\.HEAD\^2/);
		expect(unitJob).toContain("base.ref != 'main'");
	});

	// Miss-analysis: the exemption for a bot subject and the config that decided what dependabot
	// actually writes lived in different files, and no case ever fed the door a real bot subject.
	it('dependabot writes the default `Bump ...` subject the exemption matches', () => {
		const dependabot = readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
		expect(dependabot).not.toMatch(/^\s*commit-message:/m);
	});
});

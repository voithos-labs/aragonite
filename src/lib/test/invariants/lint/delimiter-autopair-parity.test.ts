/**
 * G4.65 — every editable PROSE surface routes its `beforeinput` through the delimiter auto-pair
 * arm, and no other file calls it. The arm decides what a typed delimiter writes and which side
 * the caret means afterwards; a surface carrying its own copy of that decision is the sibling-path
 * drift rules.md names, and the copy is the one that misses the next rule.
 */
import { describe, it, expect } from 'vitest';
import {
	collectEditorSources,
	isProseSurface,
	stripComments,
	type SourceFile
} from './scan-source';

const SEAM_HOME = 'src/lib/components/blocks/text/delimiter-autopair.ts';

const ROUTES_THROUGH_SEAM = /(?<![\w.])applyDelimiterAutoPair\s*\(/;

const callsSeam = (file: SourceFile): boolean =>
	file.relPath !== SEAM_HOME && ROUTES_THROUGH_SEAM.test(stripComments(file.text));

const RULE =
	'a prose surface must hand its typed delimiters to `applyDelimiterAutoPair`, which pairs, ' +
	'steps over and closes them and seats the caret afterwards; a local copy of the arm drifts';

describe('G4.65 delimiter auto-pair surface parity', () => {
	const sources = collectEditorSources();
	const surfaces = sources
		.filter(isProseSurface)
		.map((file) => file.relPath)
		.sort();

	it('found the prose surfaces to inspect', () => {
		expect(surfaces.length).toBeGreaterThanOrEqual(2);
	});

	it('every prose surface routes its typed delimiters through the arm', () => {
		const silent = sources
			.filter((file) => isProseSurface(file) && !callsSeam(file))
			.map((file) => file.relPath);
		expect(silent, RULE).toEqual([]);
	});

	it('the files calling the arm are exactly those surfaces', () => {
		const callers = sources
			.filter(callsSeam)
			.map((file) => file.relPath)
			.sort();
		expect(callers).toEqual(surfaces);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	it('the routing matcher demands a call, not a mention', () => {
		expect(ROUTES_THROUGH_SEAM.test('if (applyDelimiterAutoPair(e, deps)) return;')).toBe(true);
		expect(ROUTES_THROUGH_SEAM.test(stripComments('// applyDelimiterAutoPair(e) is the arm'))).toBe(
			false
		);
		expect(ROUTES_THROUGH_SEAM.test('const x = myApplyDelimiterAutoPair(e);')).toBe(false);
	});

	it('a prose surface that skips the arm fails the parity', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/x/Rogue.svelte',
			text: 'createEditableSurface({}); getInlineConstructPolicy(k); <div onbeforeinput={f}>',
			code: 'createEditableSurface({}); getInlineConstructPolicy(k); <div onbeforeinput={f}>'
		};
		const silent = [...sources, rogue]
			.filter((file) => isProseSurface(file) && !callsSeam(file))
			.map((file) => file.relPath);
		expect(silent).toEqual([rogue.relPath]);
	});
});

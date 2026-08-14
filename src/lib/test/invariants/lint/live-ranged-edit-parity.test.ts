/**
 * G4.44 — every editable PROSE surface routes its `beforeinput` through the live ranged-edit arm.
 * A destructive input carries the range it will rewrite on the event, not in the selection, so a
 * surface reading only `getRawSelection()` sees nothing at a collapsed caret and hands the native
 * engine a cut through delimiter runs the reader never saw. The fenced-code surface is outside the
 * set for a reason the scan can see: its body holds no inline constructs to strand.
 */
import { describe, it, expect } from 'vitest';
import { collectEditorSources, stripComments, type SourceFile } from './scan-source';

/** A component mounting an editable surface of its own. */
const SURFACE_FACTORY = /\bcreateEditable(?:Surface|Leaf)\s*\(/;

/** Its own beforeinput listener, which is where a native ranged edit is claimed or lost. */
const INSTALLS_BEFOREINPUT = /\bonbeforeinput\s*=/;

/** Hosting inline constructs is what makes a surface prose: the delimiter runs a range can cross
 *  are exactly what the policy table answers for. */
const READS_INLINE_POLICY =
	/(?<![\w.])(getInlineConstructPolicy|getInlineMarkPolicy|inlineMarkForCommand|isCardEditableInlineKind|isRevealableInlineKind)\s*\(/;

const SEAM_HOME = 'src/lib/components/blocks/text/live-selection-edit.ts';

const ROUTES_THROUGH_SEAM = /(?<![\w.])resolveLiveRangeEdit\s*\(/;

const callsSeam = (file: SourceFile): boolean =>
	file.relPath !== SEAM_HOME && ROUTES_THROUGH_SEAM.test(stripComments(file.text));

const RULE =
	'a prose surface must resolve its native ranged edits through `resolveLiveRangeEdit`, which ' +
	'reads the pending range off `getTargetRanges()` and crosses `cleanJoinedRaw`; reading the ' +
	'live selection alone loses every word, line and drag delete at a collapsed caret';

const isProseSurface = (file: SourceFile): boolean =>
	file.relPath.endsWith('.svelte') &&
	SURFACE_FACTORY.test(file.code) &&
	INSTALLS_BEFOREINPUT.test(file.code) &&
	READS_INLINE_POLICY.test(stripComments(file.text));

describe('G4.44 live ranged-edit surface parity', () => {
	const sources = collectEditorSources();
	const surfaces = sources
		.filter(isProseSurface)
		.map((file) => file.relPath)
		.sort();

	it('found the prose surfaces to inspect', () => {
		expect(surfaces.length).toBeGreaterThanOrEqual(2);
	});

	it('every prose surface routes its ranged edits through the seam', () => {
		const silent = sources
			.filter((file) => isProseSurface(file) && !callsSeam(file))
			.map((file) => file.relPath);
		expect(silent, RULE).toEqual([]);
	});

	// The other direction: a caller outside the prose surfaces is a seam conversation, since the arm
	// preventDefaults on their behalf and owns where the caret lands afterwards.
	it('the files calling the arm are exactly those surfaces', () => {
		const callers = sources
			.filter(callsSeam)
			.map((file) => file.relPath)
			.sort();
		expect(callers).toEqual(surfaces);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const probe = (text: string) =>
		isProseSurface({ relPath: 'src/lib/components/blocks/x/Probe.svelte', text, code: text });

	it('the surface matcher wants all three marks, not any one', () => {
		const whole =
			'const s = createEditableSurface({}); const p = getInlineConstructPolicy(k); <div onbeforeinput={f}>';
		expect(probe(whole)).toBe(true);
		expect(probe('const s = createEditableSurface({}); <div onbeforeinput={f}>')).toBe(false);
		expect(probe('const p = getInlineConstructPolicy(k); <div onbeforeinput={f}>')).toBe(false);
		expect(
			probe('const s = createEditableSurface({}); const p = getInlineConstructPolicy(k);')
		).toBe(false);
	});

	it('the routing matcher demands a call, not a mention', () => {
		expect(
			ROUTES_THROUGH_SEAM.test('const edit = resolveLiveRangeEdit(e, node, cursor, m, r);')
		).toBe(true);
		expect(ROUTES_THROUGH_SEAM.test(stripComments('// resolveLiveRangeEdit(e) is the arm'))).toBe(
			false
		);
		expect(ROUTES_THROUGH_SEAM.test('const x = myResolveLiveRangeEdit(e);')).toBe(false);
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

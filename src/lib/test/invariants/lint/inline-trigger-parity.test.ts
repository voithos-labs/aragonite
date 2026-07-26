/**
 * G4.18 — inline-trigger parity, three pins on the reserved-trigger contract.
 *
 * (1) `BUILTIN_TRIGGERS` (in `core/inline/scan/plugin-syntax.ts`) must equal the
 * characters the `scanInline` switch in `core/inline/scan/index.ts` dispatches —
 * its `case` labels. A trigger the switch handles but the set omits registers a
 * bare recognizer the switch then silently shadows, the exact failure the reserved
 * check exists to prevent.
 *
 * (2) Every reserved trigger is reachable by exactly one of three routes:
 * scan-visible (in `SPECIAL_CHARS`, so `needsScan` always reaches it), scan-probed
 * (in `SCAN_PROBED_RESERVED`, so `needsScan` reaches it while a rung is registered),
 * or rejected (in `SCAN_INVISIBLE_RESERVED`, so registration refuses a prefix rung).
 * A SPECIAL_CHARS edit that orphans a reserved trigger — leaving a prefix rung there a
 * silent no-op the scan never visits — fails here instead of shipping, and so does a
 * trigger claimed by two routes at once, which would make its reachability depend on
 * which check ran first. The probed route's actual wiring is pinned behaviorally, by
 * the `!` cases in `test/core/needs-scan-plugin-trigger.test.ts`: a source-level count
 * of probe call sites would pass on a probe that no longer probes.
 *
 * (3) The pre-switch prefix consultation — the seam a reserved trigger's prefix rung
 * outranks its built-in case through — has exactly one home, ahead of the switch.
 * A regression that copies the gate into a per-case arm (the sibling-path-parity bug
 * shape) would add a second consultation site; this fails the day that copy is born.
 *
 * Pins (1) and (2) read the literals in their source-literal form (`\\`, `\n`,
 * backtick as written) and compare without unescaping, so the newline trigger can't
 * decay into an actual line break mid-scan.
 */
import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

/** Inner text of every single-quoted literal in `src`, kept in source-escaped form. */
function singleQuotedLiterals(src: string): string[] {
	return [...src.matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
}

/** The members of a `<name> = new Set([...])` trigger literal in plugin-syntax.ts. */
function triggerSet(name: string): Set<string> {
	const { code } = readEditorFile('core/inline/scan/plugin-syntax.ts');
	// `[\s\S]*?` (not `[^\]]*`) so the `']'` trigger's own `]` doesn't truncate the
	// capture; the only `])` that closes it is the real end of the Set literal.
	const match = code.match(new RegExp(`${name}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
	if (!match) throw new Error(`inline-trigger-parity: ${name} literal not found`);
	return new Set(singleQuotedLiterals(match[1]));
}

/** The `SPECIAL_CHARS = '…'` string from index.ts, split into source-escaped char units. */
function specialChars(): Set<string> {
	const match = indexSource().match(/SPECIAL_CHARS\s*=\s*'((?:\\.|[^'\\])*)'/);
	if (!match) throw new Error('inline-trigger-parity: SPECIAL_CHARS literal not found');
	// `\\.` keeps `\\` and `\n` as one unit each, matching the source-escaped form
	// `singleQuotedLiterals` produces for BUILTIN_TRIGGERS — so `\n` compares to `\n`.
	const chars = [...match[1].matchAll(/\\.|[^\\]/g)].map((m) => m[0]);
	return new Set(chars);
}

/** The `case '…':` labels of the one `scanInline` switch in index.ts. */
function switchCaseTriggers(): Set<string> {
	const body = indexSource().slice(switchOffset());
	const cases = [...body.matchAll(/case\s+'((?:\\.|[^'\\])*)'\s*:/g)].map((m) => m[1]);
	return new Set(cases);
}

function indexSource(): string {
	return readEditorFile('core/inline/scan/index.ts').code;
}

function switchOffset(): number {
	const at = indexSource().indexOf('switch (raw[ctx.pos])');
	if (at < 0) throw new Error('inline-trigger-parity: scanInline switch not found');
	return at;
}

/** Start offsets of a call marker (parenthesized, so imports don't match). */
function callOffsets(marker: string): number[] {
	const code = indexSource();
	const offsets: number[] = [];
	for (let at = code.indexOf(marker); at >= 0; at = code.indexOf(marker, at + 1)) offsets.push(at);
	return offsets;
}

describe('G4.18 inline-trigger parity', () => {
	const triggers = triggerSet('BUILTIN_TRIGGERS');
	const cases = switchCaseTriggers();

	it('BUILTIN_TRIGGERS equals the scanInline switch case labels', () => {
		const onlyInTriggers = [...triggers].filter((t) => !cases.has(t)).sort();
		const onlyInSwitch = [...cases].filter((c) => !triggers.has(c)).sort();
		expect(
			{ onlyInTriggers, onlyInSwitch },
			'BUILTIN_TRIGGERS drifted from the scanInline switch case labels'
		).toEqual({ onlyInTriggers: [], onlyInSwitch: [] });
	});

	// Non-vacuity: both scans found real, populated sets — a broken regex would make
	// the equality pass vacuously on two empty sets.
	it('both scans found the triggers they read', () => {
		expect(triggers.size).toBeGreaterThan(5);
		expect(cases.size).toBeGreaterThan(5);
		expect(triggers.has('[')).toBe(true);
		expect(triggers.has('\\\\')).toBe(true); // the '\\' source literal (two backslash chars)
	});

	// A reserved trigger the `needsScan` fast bail never visits (absent from
	// SPECIAL_CHARS) must be named by one of the two on-demand routes, or a prefix rung
	// on it registers yet silently never fires. `overReach` catches the reverse rot: a
	// route naming a trigger that became scan-visible (or was never reserved) would
	// either block a now-valid registration or probe for nothing, with nothing to
	// notice. `doubleClaimed` catches the third shape — one trigger on two routes, so
	// which one governs depends on which check runs first.
	it('every reserved trigger takes exactly one route: visible, probed, or rejected', () => {
		const special = specialChars();
		const probed = triggerSet('SCAN_PROBED_RESERVED');
		const rejected = triggerSet('SCAN_INVISIBLE_RESERVED');
		expect(special.has('['), 'SPECIAL_CHARS extractor found nothing').toBe(true);
		expect(probed.has('!'), 'SCAN_PROBED_RESERVED extractor found nothing').toBe(true);
		expect(rejected.has(']'), 'SCAN_INVISIBLE_RESERVED extractor found nothing').toBe(true);

		const onDemand = [...probed, ...rejected];
		const orphaned = [...triggers]
			.filter((t) => !special.has(t) && !probed.has(t) && !rejected.has(t))
			.sort();
		const overReach = onDemand.filter((t) => special.has(t) || !triggers.has(t)).sort();
		const doubleClaimed = [...probed].filter((t) => rejected.has(t)).sort();
		expect(
			{ orphaned, overReach, doubleClaimed },
			'a reserved trigger sits outside SPECIAL_CHARS with no route, or a route names a ' +
				'scan-visible / non-reserved trigger, or one trigger takes two routes'
		).toEqual({ orphaned: [], overReach: [], doubleClaimed: [] });
	});
});

describe('G4.18 pre-switch prefix consultation — one home, ahead of the switch', () => {
	const switchAt = switchOffset();
	const gate = callOffsets('hasPrefixRungs()');
	const consult = callOffsets('getPrefixRungs(');

	it('hoists the consultation gate exactly once, before the switch', () => {
		expect(gate).toHaveLength(1);
		expect(gate[0]).toBeLessThan(switchAt);
	});

	// A per-case copy of the consultation (the bug shape this pins against) would
	// add a second `getPrefixRungs(` after the switch offset.
	it('consults reserved prefix rungs from exactly one site, before the switch', () => {
		expect(consult).toHaveLength(1);
		expect(consult[0]).toBeLessThan(switchAt);
	});
});

describe('G4.18 inline-trigger parity — extractor self-tests', () => {
	it('extracts inner literals and keeps escapes in source form (no unescaping)', () => {
		expect(singleQuotedLiterals("'a', 'b'")).toEqual(['a', 'b']);
		expect(singleQuotedLiterals("'\\n'")).toEqual(['\\n']); // stays backslash-n, not a newline
		expect(singleQuotedLiterals("'\\\\'")).toEqual(['\\\\']); // stays two backslash chars
	});
});

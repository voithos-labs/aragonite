/**
 * G4.18 — inline-trigger parity, two pins on the reserved-trigger contract.
 *
 * (1) `BUILTIN_TRIGGERS` (in `core/inline/scan/plugin-syntax.ts`) must equal the
 * characters the `scanInline` switch in `core/inline/scan/index.ts` dispatches —
 * its `case` labels. A trigger the switch handles but the set omits registers a
 * bare recognizer the switch then silently shadows, the exact failure the reserved
 * check exists to prevent.
 *
 * (2) The pre-switch prefix consultation — the seam a reserved trigger's prefix rung
 * outranks its built-in case through — has exactly one home, ahead of the switch.
 * A regression that copies the gate into a per-case arm (the sibling-path-parity bug
 * shape) would add a second consultation site; this fails the day that copy is born.
 *
 * Both sides of pin (1) are read in their source-literal form (`\\`, `\n`, backtick
 * as written) and compared without unescaping, so the newline trigger can't decay
 * into an actual line break mid-scan.
 */
import { describe, it, expect } from 'vitest';
import { readEditorFile } from './scan-source';

/** Inner text of every single-quoted literal in `src`, kept in source-escaped form. */
function singleQuotedLiterals(src: string): string[] {
	return [...src.matchAll(/'((?:\\.|[^'\\])*)'/g)].map((m) => m[1]);
}

/** The `BUILTIN_TRIGGERS = new Set([...])` members from plugin-syntax.ts. */
function builtinTriggers(): Set<string> {
	const { code } = readEditorFile('core/inline/scan/plugin-syntax.ts');
	// `[\s\S]*?` (not `[^\]]*`) so the `']'` trigger's own `]` doesn't truncate the
	// capture; the only `])` that closes it is the real end of the Set literal.
	const match = code.match(/BUILTIN_TRIGGERS\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
	if (!match) throw new Error('inline-trigger-parity: BUILTIN_TRIGGERS literal not found');
	return new Set(singleQuotedLiterals(match[1]));
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
	const triggers = builtinTriggers();
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

/**
 * G4.18 — inline-trigger parity. `registerInlineSyntax` rejects a plugin trigger
 * that the built-in scanner already claims, using the `BUILTIN_TRIGGERS` set in
 * `core/inline/scan/plugin-syntax.ts`. That set must equal the characters the
 * `scanInline` switch in `core/inline/scan/index.ts` actually dispatches — its
 * `case` labels. A trigger the switch handles but the set omits would be accepted
 * by the public API and then silently shadowed by the switch (the recognizer never
 * fires), which is the exact failure the rejection exists to prevent. The two lived
 * in step by a "keep in step with the switch" comment only; this pins it.
 *
 * Both sides are read in their source-literal form (`\\`, `\n`, backtick as
 * written) and compared without unescaping, so the newline trigger can't decay
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
	const { code } = readEditorFile('core/inline/scan/index.ts');
	const switchAt = code.indexOf('switch (raw[ctx.pos])');
	if (switchAt < 0) throw new Error('inline-trigger-parity: scanInline switch not found');
	const body = code.slice(switchAt);
	const cases = [...body.matchAll(/case\s+'((?:\\.|[^'\\])*)'\s*:/g)].map((m) => m[1]);
	return new Set(cases);
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

describe('G4.18 inline-trigger parity — extractor self-tests', () => {
	it('extracts inner literals and keeps escapes in source form (no unescaping)', () => {
		expect(singleQuotedLiterals("'a', 'b'")).toEqual(['a', 'b']);
		expect(singleQuotedLiterals("'\\n'")).toEqual(['\\n']); // stays backslash-n, not a newline
		expect(singleQuotedLiterals("'\\\\'")).toEqual(['\\\\']); // stays two backslash chars
	});
});

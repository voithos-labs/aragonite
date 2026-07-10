import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '$lib/core/nodes';
import { parseInline } from '$lib/core/inline';
import {
	__resetInlineSyntaxForTests,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '$lib/core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

// A minimal `:` trigger: claims `:…}`. The `{…}` (label-less) form isolates the
// probe — `{`, `}`, `=` are not SPECIAL chars, so only `:` can force a scan. A
// `[label]` form would trip needsScan on the `[` alone and hide a missing probe.
const recognizeColon: InlineSyntaxRecognizer = (raw, pos, end) => {
	if (raw[pos] !== ':') return null;
	const close = raw.indexOf('}', pos);
	if (close < 0 || close >= end) return null;
	return { kind: 'directiveText' as InlineNode['kind'], start: pos, end: close + 1 };
};

// `:` is a PROBE_SCHEME char (autolink `://`), held out of the unconditional
// SPECIAL set. The fast-bail must additionally probe a registered `:` trigger or
// an inline directive would be missed per keystroke — without regressing the
// empty-registry path the conformance oracle pins.
describe('needsScan probes a registered ":" trigger', () => {
	it('empty registry: ":x" stays one byte-identical text node', () => {
		expect(parseInline(':x', 0, 2)).toEqual([{ kind: 'text', start: 0, end: 2, text: ':x' }]);
	});

	it('registered ":" recognizer is consulted — ":x{k=v}" does not fast-bail to text', () => {
		registerInlineSyntax(':', recognizeColon);
		const nodes = parseInline(':x{k=v}', 0, 7);
		expect(nodes).not.toEqual([{ kind: 'text', start: 0, end: 7, text: ':x{k=v}' }]);
		expect(nodes.some((n) => n.kind === 'directiveText')).toBe(true);
	});
});

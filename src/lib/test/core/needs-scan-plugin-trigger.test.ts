import { afterEach, describe, expect, it } from 'vitest';
import type { InlineNode } from '$lib/core/nodes';
import { parseInline } from '$lib/core/inline';
import {
	__resetInlineSyntaxForTests,
	registerInlineSyntax,
	type InlineSyntaxRecognizer
} from '$lib/core/inline/scan/plugin-syntax';

afterEach(() => __resetInlineSyntaxForTests());

// The label-less `{…}` form isolates the probe: `{`, `}`, `=` are not SPECIAL chars, so
// only the trigger can force a scan. A `[label]` form would trip needsScan on the `[`.
const recognizer =
	(trigger: string): InlineSyntaxRecognizer =>
	(raw, pos, end) => {
		if (raw[pos] !== trigger) return null;
		const close = raw.indexOf('}', pos);
		if (close < 0 || close >= end) return null;
		return { kind: 'directiveText' as InlineNode['kind'], start: pos, end: close + 1 };
	};
const recognizeColon = recognizer(':');

// `:` is a PROBE_SCHEME char held out of the unconditional SPECIAL set, so the fast bail
// must probe the registry too — without regressing the empty-registry path.
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

// `w`/`W` are the PROBE_WWW arm, sibling to `:` above: the registry probe must be carried
// at BOTH conditional-probe arms (sibling-path parity).
describe('needsScan probes a registered "w" trigger', () => {
	it('empty registry: "wx" stays one byte-identical text node', () => {
		expect(parseInline('wx', 0, 2)).toEqual([{ kind: 'text', start: 0, end: 2, text: 'wx' }]);
	});

	it('registered "w" recognizer is consulted — "w{k=v}" does not fast-bail to text', () => {
		registerInlineSyntax('w', recognizer('w'));
		const nodes = parseInline('w{k=v}', 0, 6);
		expect(nodes).not.toEqual([{ kind: 'text', start: 0, end: 6, text: 'w{k=v}' }]);
		expect(nodes.some((n) => n.kind === 'directiveText')).toBe(true);
	});

	it('a registered "w" trigger does not shadow the www. autolink probe', () => {
		registerInlineSyntax('w', recognizer('w'));
		const raw = 'see www.example.com now';
		const nodes = parseInline(raw, 0, raw.length);
		expect(nodes.some((n) => n.kind === 'autolink')).toBe(true);
	});
});

// `!` is reserved yet held out of SPECIAL_CHARS, so its prefix rungs need the same probe.
// `!{k=v}` carries no `[`, so only the probe can save it from the fast bail.
describe('needsScan probes a registered "!" prefix rung', () => {
	it('empty registry: "!{k=v}" stays one byte-identical text node', () => {
		expect(parseInline('!{k=v}', 0, 6)).toEqual([
			{ kind: 'text', start: 0, end: 6, text: '!{k=v}' }
		]);
	});

	it('registered "!{" rung is consulted — "!{k=v}" does not fast-bail to text', () => {
		registerInlineSyntax('!', recognizer('!'), { prefix: '!{', priority: 40 });
		const nodes = parseInline('!{k=v}', 0, 6);
		expect(nodes).toEqual([{ kind: 'directiveText', start: 0, end: 6 }]);
	});

	it('a registered "!" rung leaves prose exclamation marks alone', () => {
		registerInlineSyntax('!', recognizer('!'), { prefix: '!{', priority: 40 });
		const raw = 'wow! really';
		expect(parseInline(raw, 0, raw.length)).toEqual([
			{ kind: 'text', start: 0, end: raw.length, text: raw }
		]);
	});
});

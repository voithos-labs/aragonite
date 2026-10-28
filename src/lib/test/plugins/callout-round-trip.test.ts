import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import {
	registerCalloutKind,
	rebuildCalloutRaw
} from '../../../routes/test/plugins/callout/callout-kind';
import { testView } from '#lib/test/harness/test-view.js';

const TWO_PARA = ':::callout\nHello **world**\n\nSecond para\n:::\n';
const TITLED = ':::callout My Title\nBody\n:::\n';
const UNTITLED = ':::callout\nBody\n:::\n';

describe('callout kind round-trip', () => {
	beforeEach(() => {
		registerCalloutKind(testView());
	});

	it('round-trips a note container byte-for-byte', () => {
		expect(serialize(parse(TWO_PARA))).toBe(TWO_PARA);
	});

	it('parses to a note container: its opener line at child 0 + its body blocks', () => {
		const note = parse(TWO_PARA).children[0];
		expect(note.kind).toBe('callout');
		// Child 0 is the opener line; the body follows.
		expect(note.children?.length).toBe(3);
		expect(note.children?.[0].kind).toBe('directiveOpenerLine');
		expect(note.children?.slice(1).map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('round-trips nested block kinds (heading + list) inside the callout', () => {
		const src = ':::callout\n# Title\n\n- a\n- b\n:::\n';
		expect(serialize(parse(src))).toBe(src);

		const note = parse(src).children[0];
		expect(note.children?.map((c) => c.kind)).toEqual(['directiveOpenerLine', 'heading', 'list']);
	});

	it('parses the opener line, title included, into child 0', () => {
		const note = parse(TITLED).children[0];
		expect(note.kind).toBe('callout');
		expect(note.children?.[0].kind).toBe('directiveOpenerLine');
		expect(note.children?.[0].raw).toBe(':::callout My Title\n');
		expect(note.children?.[1].kind).toBe('paragraph');
	});

	it('round-trips a titled callout byte-for-byte', () => {
		expect(serialize(parse(TITLED))).toBe(TITLED);
	});

	it('holds the bare opener line when it carries no title', () => {
		const note = parse(UNTITLED).children[0];
		expect(note.children?.[0].kind).toBe('directiveOpenerLine');
		expect(note.children?.[0].raw).toBe(':::callout\n');
		expect(serialize(parse(UNTITLED))).toBe(UNTITLED);
	});

	it('declines an unterminated fence, leaving it as a paragraph', () => {
		const src = ':::callout\nno closing fence\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).not.toBe('callout');
	});
});

// `rebuildCalloutRaw` runs when the callout's children change and puts the title back on the
// opener line; the round trips above only read the opener's verbatim `raw`.
describe('callout rebuildRaw is the opener inverse', () => {
	beforeEach(() => {
		registerCalloutKind(testView());
	});

	it('reproduces the parsed raw, including the inner blank-line separator', () => {
		const note = parse(TWO_PARA).children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(TWO_PARA);
	});

	it('re-emits an opener-line title from child 0', () => {
		const note = parse(TITLED).children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(TITLED);
	});

	it('preserves a non-note fence label from metadata (no hardcoded type)', () => {
		const note = parse(':::aside\nx\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::aside\nx\n:::\n');
	});
});

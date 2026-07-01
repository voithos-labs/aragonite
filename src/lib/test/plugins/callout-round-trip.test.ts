import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import {
	registerCalloutKind,
	rebuildCalloutRaw
} from '../../../routes/test/plugins/callout/callout-kind';

describe('callout kind round-trip', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerCalloutKind();
	});

	it('round-trips a note container byte-for-byte', () => {
		const src = ':::note\nHello **world**\n\nSecond para\n:::\n';
		expect(serialize(parse(src))).toBe(src);
	});

	it('parses to a note container holding its child blocks', () => {
		const src = ':::note\nHello **world**\n\nSecond para\n:::\n';
		const note = parse(src).children[0];
		expect(note.kind).toBe('note');
		expect(note.children?.length).toBe(2);
	});

	it('round-trips nested block kinds (heading + list) inside the callout', () => {
		const src = ':::note\n# Title\n\n- a\n- b\n:::\n';
		expect(serialize(parse(src))).toBe(src);

		const note = parse(src).children[0];
		expect(note.children?.map((c) => c.kind)).toEqual(['heading', 'list']);
	});

	it('declines an unterminated fence, leaving it as a paragraph', () => {
		const src = ':::note\nno closing fence\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).not.toBe('note');
	});
});

// The round-trip suite above only exercises the opener's verbatim `raw`; these
// guard `rebuildCalloutRaw` directly — the strip-contract inverse the editor
// runs when the callout's children mutate.
describe('callout rebuildRaw is the opener inverse', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		registerCalloutKind();
	});

	it('reproduces the parsed raw, including the inner blank-line separator', () => {
		const note = parse(':::note\nHello **world**\n\nSecond para\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note\nHello **world**\n\nSecond para\n:::\n');
	});

	it('preserves a non-note fence label from metadata (no hardcoded type)', () => {
		const note = parse(':::warning\nx\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::warning\nx\n:::\n');
	});
});

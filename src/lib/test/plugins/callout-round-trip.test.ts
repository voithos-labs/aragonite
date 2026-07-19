import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { resetPluginPlatformForTests } from '$lib/testing';
import {
	registerCalloutKind,
	rebuildCalloutRaw
} from '../../../routes/test/plugins/callout/callout-kind';

describe('callout kind round-trip', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	it('round-trips a note container byte-for-byte', () => {
		const src = ':::note\nHello **world**\n\nSecond para\n:::\n';
		expect(serialize(parse(src))).toBe(src);
	});

	it('parses to a note container: reserved title child 0 + its body blocks', () => {
		const src = ':::note\nHello **world**\n\nSecond para\n:::\n';
		const note = parse(src).children[0];
		expect(note.kind).toBe('note');
		// Child 0 is the reserved (here empty) note-title; the body follows.
		expect(note.children?.length).toBe(3);
		expect(note.children?.[0].kind).toBe('note-title');
		expect(note.children?.slice(1).map((c) => c.kind)).toEqual(['paragraph', 'paragraph']);
	});

	it('round-trips nested block kinds (heading + list) inside the callout', () => {
		const src = ':::note\n# Title\n\n- a\n- b\n:::\n';
		expect(serialize(parse(src))).toBe(src);

		const note = parse(src).children[0];
		expect(note.children?.map((c) => c.kind)).toEqual(['note-title', 'heading', 'list']);
	});

	it('parses an opener-line title into a reserved note-title child', () => {
		const note = parse(':::note My Title\nBody\n:::\n').children[0];
		expect(note.kind).toBe('note');
		expect(note.children?.[0].kind).toBe('note-title');
		expect(note.children?.[0].raw).toBe('My Title\n');
		expect(note.children?.[1].kind).toBe('paragraph');
	});

	it('round-trips a titled callout byte-for-byte', () => {
		const src = ':::note My Title\nBody\n:::\n';
		expect(serialize(parse(src))).toBe(src);
	});

	it('reserves an empty note-title child when the opener carries no title', () => {
		const note = parse(':::note\nBody\n:::\n').children[0];
		expect(note.children?.[0].kind).toBe('note-title');
		expect(note.children?.[0].raw).toBe('\n');
		expect(serialize(parse(':::note\nBody\n:::\n'))).toBe(':::note\nBody\n:::\n');
	});

	it('declines an unterminated fence, leaving it as a paragraph', () => {
		const src = ':::note\nno closing fence\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).not.toBe('note');
	});
});

// The round-trip suite above only exercises the opener's verbatim `raw`; these
// guard `rebuildCalloutRaw` directly — the container-rebuild inverse the editor
// runs when the callout's children mutate (the title returns to the opener line).
describe('callout rebuildRaw is the opener inverse', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		registerCalloutKind();
	});

	it('reproduces the parsed raw, including the inner blank-line separator', () => {
		const note = parse(':::note\nHello **world**\n\nSecond para\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note\nHello **world**\n\nSecond para\n:::\n');
	});

	it('re-emits an opener-line title from child 0', () => {
		const note = parse(':::note My Title\nBody\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::note My Title\nBody\n:::\n');
	});

	it('preserves a non-note fence label from metadata (no hardcoded type)', () => {
		const note = parse(':::warning\nx\n:::\n').children[0];
		rebuildCalloutRaw(note);
		expect(note.raw).toBe(':::warning\nx\n:::\n');
	});
});

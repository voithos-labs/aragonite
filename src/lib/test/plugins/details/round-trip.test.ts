import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '#lib';
import { getPluginMetadata } from '#lib/plugin.js';
import { DETAILS, SUMMARY, detailsGrammar } from '#lib/test/support/details-grammar.js';
import { writeContainerRaw } from '#lib/schema/container-writer.js';

let grammar: ReturnType<typeof detailsGrammar>;
const read = (source: string) => parse(source, { grammar });

// A canonical open details with a titled summary and a blank-line-wrapped body.
const OPEN_SRC = '<details open>\n<summary>Title</summary>\n\nBody\n\n</details>\n';
const CLOSED_SRC = '<details>\n<summary>Title</summary>\n\nBody\n\n</details>\n';

describe('details kind round-trip', () => {
	beforeEach(() => {
		grammar = detailsGrammar();
	});

	it('round-trips an open details byte-for-byte', () => {
		expect(serialize(read(OPEN_SRC))).toBe(OPEN_SRC);
	});

	it('round-trips a closed details byte-for-byte', () => {
		expect(serialize(read(CLOSED_SRC))).toBe(CLOSED_SRC);
	});

	it('parses to a details container: reserved summary child 0 + its body blocks', () => {
		const details = read(OPEN_SRC).children[0];
		expect(details.kind).toBe(DETAILS);
		expect(details.children?.length).toBe(2);
		expect(details.children?.[0].kind).toBe(SUMMARY);
		expect(details.children?.[0].raw).toBe('Title\n');
		expect(details.children?.[1].kind).toBe('paragraph');
	});

	it('carries the open state in metadata', () => {
		expect(getPluginMetadata<{ open: boolean }>(read(OPEN_SRC).children[0])?.open).toBe(true);
		expect(getPluginMetadata<{ open: boolean }>(read(CLOSED_SRC).children[0])?.open).toBe(false);
	});

	it('round-trips nested block kinds (heading + list) inside the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n# Heading\n\n- a\n- b\n\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		const details = read(src).children[0];
		expect(details.children?.map((c) => c.kind)).toEqual([SUMMARY, 'heading', 'list']);
	});

	it('round-trips a nested details (depth-counted close scan)', () => {
		const src =
			'<details>\n<summary>Outer</summary>\n\n' +
			'<details>\n<summary>Inner</summary>\n\ninner body\n\n</details>\n\n' +
			'</details>\n';
		expect(serialize(read(src))).toBe(src);
		const outer = read(src).children[0];
		expect(outer.kind).toBe(DETAILS);
		expect(outer.children?.map((c) => c.kind)).toEqual([SUMMARY, DETAILS]);
		const inner = outer.children?.[1];
		expect(inner?.children?.[0].kind).toBe(SUMMARY);
		expect(inner?.children?.[0].raw).toBe('Inner\n');
	});

	it('accepts and round-trips an empty summary with a body', () => {
		const src = '<details>\n<summary></summary>\n\nBody\n\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		const details = read(src).children[0];
		expect(details.kind).toBe(DETAILS);
		expect(details.children?.[0].kind).toBe(SUMMARY);
		expect(details.children?.[0].raw).toBe('\n');
	});

	it('accepts and round-trips an empty summary with an empty body', () => {
		const src = '<details>\n<summary></summary>\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		const details = read(src).children[0];
		expect(details.kind).toBe(DETAILS);
		expect(details.children?.length).toBe(1);
		expect(details.children?.[0].kind).toBe(SUMMARY);
	});

	it('declines non-canonical <details class=x>, leaving it to htmlBlock', () => {
		const src = '<details class="x">\nBody\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		expect(read(src).children[0].kind).toBe('htmlBlock');
	});

	it('declines an unterminated details, leaving it to htmlBlock', () => {
		const src = '<details>\n<summary>T</summary>\n\nno closing tag\n';
		expect(serialize(read(src))).toBe(src);
		expect(read(src).children[0].kind).not.toBe(DETAILS);
	});

	it('declines when no <summary> line follows the opener', () => {
		const src = '<details>\nBody\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		expect(read(src).children[0].kind).not.toBe(DETAILS);
	});
});

// `<details>` interrupts an open paragraph, as htmlBlock does, so the same text opens a details
// in either position, while any other `<details …>` spelling falls through to htmlBlock in both.
describe('details opener paragraph-interrupt parity', () => {
	beforeEach(() => {
		grammar = detailsGrammar();
	});

	it('claims a details directly after a paragraph', () => {
		const src = 'Above\n<details>\n<summary>T</summary>\n\nBody\n\n</details>\n';
		expect(serialize(read(src))).toBe(src);
		const doc = read(src);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe(DETAILS);
	});

	it('falls a non-canonical opener after a paragraph through to htmlBlock', () => {
		const src = 'Above\n<details class="x">\nstuff\n';
		expect(serialize(read(src))).toBe(src);
		const doc = read(src);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('htmlBlock');
	});
});

// `rebuildRaw` runs when the children change, and a stale or nondeterministic rebuild leaves raw
// disagreeing with them, so the inverse and its determinism are asserted (G1.12, G1.13).
describe('details rebuildRaw is the opener inverse', () => {
	beforeEach(() => {
		grammar = detailsGrammar();
	});

	it('reproduces the parsed raw, including the blank-line body wrap', () => {
		const details = read(OPEN_SRC).children[0];
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(OPEN_SRC);
	});

	it('re-emits the closed opener from metadata', () => {
		const details = read(CLOSED_SRC).children[0];
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(CLOSED_SRC);
	});

	it('re-emits an empty summary line', () => {
		const src = '<details>\n<summary></summary>\n\nBody\n\n</details>\n';
		const details = read(src).children[0];
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(src);
	});

	// The extraction trims only the trailing line ending, since `.trim()` would strip interior
	// summary padding and drift the header line; no other input tells the two apart.
	it('preserves interior summary padding, trimming only the line ending', () => {
		const src = '<details>\n<summary>  Padded  </summary>\n\nBody\n\n</details>\n';
		const details = read(src).children[0];
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(src);
	});

	it('is deterministic across repeated rebuilds (G1.13)', () => {
		const details = read(OPEN_SRC).children[0];
		writeContainerRaw(details, grammar);
		const first = details.raw;
		writeContainerRaw(details, grammar);
		expect(details.raw).toBe(first);
	});
});

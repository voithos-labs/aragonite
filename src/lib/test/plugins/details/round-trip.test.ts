import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getPluginMetadata } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { registerDetailsKind, rebuildDetailsRaw } from '$lib/plugins/details/details-kind';

// A canonical open details with a titled summary and a blank-line-wrapped body.
const OPEN_SRC = '<details open>\n<summary>Title</summary>\n\nBody\n\n</details>\n';
const CLOSED_SRC = '<details>\n<summary>Title</summary>\n\nBody\n\n</details>\n';

function resetAndRegister(): void {
	// registerDetailsKind registers a chrome-leaf paste surface; reset it too or
	// the re-register collides with the orphaned entry (callout suite convention).
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
}

describe('details kind round-trip', () => {
	beforeEach(resetAndRegister);

	it('round-trips an open details byte-for-byte', () => {
		expect(serialize(parse(OPEN_SRC))).toBe(OPEN_SRC);
	});

	it('round-trips a closed details byte-for-byte', () => {
		expect(serialize(parse(CLOSED_SRC))).toBe(CLOSED_SRC);
	});

	it('parses to a details container: reserved summary child 0 + its body blocks', () => {
		const details = parse(OPEN_SRC).children[0];
		expect(details.kind).toBe('details');
		expect(details.children?.length).toBe(2);
		expect(details.children?.[0].kind).toBe('details-summary');
		expect(details.children?.[0].raw).toBe('Title\n');
		expect(details.children?.[1].kind).toBe('paragraph');
	});

	it('carries the open state in metadata', () => {
		expect(getPluginMetadata<{ open: boolean }>(parse(OPEN_SRC).children[0])?.open).toBe(true);
		expect(getPluginMetadata<{ open: boolean }>(parse(CLOSED_SRC).children[0])?.open).toBe(false);
	});

	it('round-trips nested block kinds (heading + list) inside the body', () => {
		const src = '<details>\n<summary>T</summary>\n\n# Heading\n\n- a\n- b\n\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		const details = parse(src).children[0];
		expect(details.children?.map((c) => c.kind)).toEqual(['details-summary', 'heading', 'list']);
	});

	it('round-trips a nested details (depth-counted close scan)', () => {
		const src =
			'<details>\n<summary>Outer</summary>\n\n' +
			'<details>\n<summary>Inner</summary>\n\ninner body\n\n</details>\n\n' +
			'</details>\n';
		expect(serialize(parse(src))).toBe(src);
		const outer = parse(src).children[0];
		expect(outer.kind).toBe('details');
		expect(outer.children?.map((c) => c.kind)).toEqual(['details-summary', 'details']);
		const inner = outer.children?.[1];
		expect(inner?.children?.[0].kind).toBe('details-summary');
		expect(inner?.children?.[0].raw).toBe('Inner\n');
	});

	it('accepts and round-trips an empty summary with a body', () => {
		const src = '<details>\n<summary></summary>\n\nBody\n\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		const details = parse(src).children[0];
		expect(details.kind).toBe('details');
		expect(details.children?.[0].kind).toBe('details-summary');
		expect(details.children?.[0].raw).toBe('\n');
	});

	it('accepts and round-trips an empty summary with an empty body', () => {
		const src = '<details>\n<summary></summary>\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		const details = parse(src).children[0];
		expect(details.kind).toBe('details');
		expect(details.children?.length).toBe(1);
		expect(details.children?.[0].kind).toBe('details-summary');
	});

	it('declines non-canonical <details class=x>, leaving it to htmlBlock', () => {
		const src = '<details class="x">\nBody\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).toBe('htmlBlock');
	});

	it('declines an unterminated details, leaving it to htmlBlock', () => {
		const src = '<details>\n<summary>T</summary>\n\nno closing tag\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).not.toBe('details');
	});

	it('declines when no <summary> line follows the opener', () => {
		const src = '<details>\nBody\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		expect(parse(src).children[0].kind).not.toBe('details');
	});
});

// `<details>` interrupts an open paragraph (htmlBlock parity), so the same text
// claims as a details whether it starts a window or follows a paragraph — while a
// non-canonical `<details …>` still falls through to htmlBlock in both positions.
describe('details opener paragraph-interrupt parity', () => {
	beforeEach(resetAndRegister);

	it('claims a details directly after a paragraph', () => {
		const src = 'Above\n<details>\n<summary>T</summary>\n\nBody\n\n</details>\n';
		expect(serialize(parse(src))).toBe(src);
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('details');
	});

	it('falls a non-canonical opener after a paragraph through to htmlBlock', () => {
		const src = 'Above\n<details class="x">\nstuff\n';
		expect(serialize(parse(src))).toBe(src);
		const doc = parse(src);
		expect(doc.children[0].kind).toBe('paragraph');
		expect(doc.children[1].kind).toBe('htmlBlock');
	});
});

// The suite above only exercises the opener's verbatim `raw`; these guard the rebuild
// inverse the editor runs when the children mutate. A stale or nondeterministic
// rebuild trips G1.12/G1.13, so determinism is asserted explicitly.
describe('details rebuildRaw is the opener inverse', () => {
	beforeEach(resetAndRegister);

	it('reproduces the parsed raw, including the blank-line body wrap', () => {
		const details = parse(OPEN_SRC).children[0];
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(OPEN_SRC);
	});

	it('re-emits the closed opener from metadata', () => {
		const details = parse(CLOSED_SRC).children[0];
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(CLOSED_SRC);
	});

	it('re-emits an empty summary line', () => {
		const src = '<details>\n<summary></summary>\n\nBody\n\n</details>\n';
		const details = parse(src).children[0];
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(src);
	});

	// Summary padding survives rebuild only because the extraction trims the
	// trailing line ending alone; `.trim()` would strip the interior spaces and
	// drift the header line. This is the sole input where the two diverge.
	it('preserves interior summary padding, trimming only the line ending', () => {
		const src = '<details>\n<summary>  Padded  </summary>\n\nBody\n\n</details>\n';
		const details = parse(src).children[0];
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(src);
	});

	it('is deterministic across repeated rebuilds (G1.13)', () => {
		const details = parse(OPEN_SRC).children[0];
		rebuildDetailsRaw(details);
		const first = details.raw;
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(first);
	});
});

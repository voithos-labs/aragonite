import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode } from '$lib/tree-operations/node-ops';
import { rebuildAncestryRaw } from '$lib/schema/container-raw';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import { registerCalloutKind } from '../../../routes/test/plugins/callout/callout-kind';
import { expectParseConverged } from '../harness/parse-converged';
import type { CstNode } from '$lib/core/nodes';

// Miss-analysis (wrapped-container settle): the splice families were pinned at the document
// top, where `prefix` is always empty. Inside a container whose parse peels the blank line
// against its opener into `innerPrefix`, the same settle dropped the line the peel eats, so
// the body head vanished on reload — and with reserved chrome at index 0, the settle read the
// chrome leaf as a body predecessor and declined instead.

/** Delete a body child the way a caller does: splice, then re-derive the ancestry's raw. */
function deleteBodyChild(
	source: string,
	at: number
): { doc: ReturnType<typeof parse>; raw: string } {
	const doc = parse(source);
	deleteNode(doc.children[0] as unknown as { children: CstNode[] }, at);
	rebuildAncestryRaw(doc.children[0], []);
	return { doc, raw: serialize(doc) };
}

describe('separator settle inside a chrome-wrapped container', () => {
	beforeEach(() => {
		// registerChromeLeaf registers a paste surface, so the schema reset alone would leave
		// it orphaned and a re-register would collide.
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});
	afterEach(__resetSchemaRegistriesForTests);

	it('hands the freed separator to the wrap when the body head has none', () => {
		const { doc, raw } = deleteBodyChild(':::callout\nA\n\nB\n:::\n', 1);

		expect(raw).toBe(':::callout\n\nB\n:::\n');
		expect(doc.children[0].innerPrefix).toBe('\n');
		expectParseConverged(doc);
	});

	it('drops it when the wrap already holds its line', () => {
		const { doc, raw } = deleteBodyChild(':::callout\n\nA\n\nB\n:::\n', 1);

		expect(raw).toBe(':::callout\n\nB\n:::\n');
		expect(doc.children[0].innerPrefix).toBe('\n');
		expectParseConverged(doc);
	});

	// The chrome leaf sits at child 0 and is not a body block, so the body head is child 1:
	// reading the leaf as a predecessor left the head separated from nothing.
	it('treats the reserved chrome leaf as above the body, not as a predecessor', () => {
		const doc = parse(':::callout Title\n\nA\n\nB\n:::\n');
		expect(doc.children[0].children?.[0].kind).toBe('callout-title');

		deleteNode(doc.children[0] as unknown as { children: CstNode[] }, 1);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].children?.[1].leadingTrivia).toBe('');
		expectParseConverged(doc);
	});

	it('keeps a blank body head alive by moving the separator above it', () => {
		const doc = parse(':::callout\n\n\nB\n\nC\n:::\n');
		expect(doc.children[0].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'B\n', 'C\n']);

		// Drop B, leaving the blank head and C, whose separator is then the only spare line.
		deleteNode(doc.children[0] as unknown as { children: CstNode[] }, 2);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'C\n']);
		expectParseConverged(doc);
	});
});

describe('separator settle inside a strip container', () => {
	beforeEach(activateDirectiveGrammar);

	// Non-vacuity for the wrap gate: a blockquote body opens at the container's own first line,
	// so nothing peels and the settle must DROP the separator it frees.
	it('drops the freed separator — a blockquote peels nothing', () => {
		const doc = parse('> a\n>\n>\n> b\n');

		deleteNode(doc.children[0] as unknown as { children: CstNode[] }, 2);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].innerPrefix).toBe('');
		expect(serialize(doc)).toBe('> a\n>\n>\n');
		expectParseConverged(doc);
	});
});

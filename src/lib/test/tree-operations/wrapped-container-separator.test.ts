import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { deleteNode, updateNodeContent } from '$lib/tree-operations/node-ops';
import { trailingLineEnding } from '$lib/core/lines';
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

/** The sinks' answer bundle for a container's own children — the shape every caller hands. */
function bodyParentOf(container: CstNode) {
	return { children: container.children!, ownerKind: container.kind, owner: container };
}

/** Delete a body child the way a caller does: splice, then re-derive the ancestry's raw. */
function deleteBodyChild(
	source: string,
	at: number
): { doc: ReturnType<typeof parse>; raw: string } {
	const doc = parse(source);
	deleteNode(bodyParentOf(doc.children[0]), at);
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

		deleteNode(bodyParentOf(doc.children[0]), 1);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].children?.[1].leadingTrivia).toBe('');
		expectParseConverged(doc);
	});

	it('keeps a blank body head alive by moving the separator above it', () => {
		const doc = parse(':::callout\n\n\nB\n\nC\n:::\n');
		expect(doc.children[0].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'B\n', 'C\n']);

		// Drop B, leaving the blank head and C, whose separator is then the only spare line.
		deleteNode(bodyParentOf(doc.children[0]), 2);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].children?.map((c) => c.raw)).toEqual(['\n', '\n', 'C\n']);
		expectParseConverged(doc);
	});
});

// GH #101: a body block emptied against a chrome line owes TWO lines — one the wrap's parse
// peels into `innerPrefix`/`innerSuffix`, one to materialize as a block — and the settle
// counted at most one. Miss-analysis: every emptied-block case ran at the document top or in a
// strip container, where no chrome line bounds the run and one line is always enough.
describe('emptying a body block against the wrap’s chrome lines', () => {
	beforeEach(() => {
		__resetSchemaRegistriesForTests();
		__resetPasteSurfacesForTests();
		registerCalloutKind();
	});
	afterEach(__resetSchemaRegistriesForTests);

	/** The emptied-block gesture through the container sink: commitInput sends the ending alone. */
	function emptyBodyChild(container: CstNode, at: number): void {
		updateNodeContent(
			{ children: container.children!, ownerKind: container.kind, owner: container },
			at,
			trailingLineEnding(container.children![at].raw)
		);
		rebuildAncestryRaw(container, []);
	}

	it('keeps an emptied LAST body block by handing the closer line to innerSuffix', () => {
		const doc = parse(':::callout Title\nBody1\n\nBody2\n:::\n');
		const callout = doc.children[0];
		expect(callout.innerSuffix ?? '').toBe('');

		emptyBodyChild(callout, 2);

		expect(callout.innerSuffix).toBe('\n');
		expectParseConverged(doc);
	});

	it('keeps an emptied FIRST body block by handing the opener line to innerPrefix', () => {
		const doc = parse(':::callout Title\n```\nc\n```\nBody2\n:::\n');
		const callout = doc.children[0];
		expect(callout.children!.map((c) => c.kind)).toEqual([
			'callout-title',
			'fencedCode',
			'paragraph'
		]);

		emptyBodyChild(callout, 1);

		expect(callout.innerPrefix).toBe('\n');
		expectParseConverged(doc);
	});

	// The standing line already IS the peel line on reload — the settle keeps the first line
	// that stands rather than rewriting byte-equivalent shapes (§ Blank lines).
	it('leaves a standing follower separator as the peel line, minting nothing', () => {
		const doc = parse(':::callout Title\n```\nc\n```\n\nBody2\n:::\n');
		const callout = doc.children[0];
		expect(callout.children![2].leadingTrivia).toBe('\n');

		emptyBodyChild(callout, 1);

		expect(callout.innerPrefix).toBe('');
		expect(callout.children![2].leadingTrivia).toBe('\n');
		expectParseConverged(doc);
	});

	// An all-blank single-line body sits under both peel guards (each needs two lines to
	// engage), so the lean one-line form already reloads as the block.
	it('an emptied ONLY body block needs no wrap line at all', () => {
		const doc = parse(':::callout Title\nBody\n:::\n');
		const callout = doc.children[0];

		emptyBodyChild(callout, 1);

		expect(callout.innerPrefix).toBe('');
		expect(callout.innerSuffix ?? '').toBe('');
		expect(serialize(doc)).toBe(':::callout Title\n\n:::\n');
		expectParseConverged(doc);
	});

	it('the CRLF twin hands over CRLF lines', () => {
		const doc = parse(':::callout Title\r\nBody1\r\n\r\nBody2\r\n:::\r\n');
		const callout = doc.children[0];

		emptyBodyChild(callout, 2);

		expect(callout.innerSuffix).toBe('\r\n');
		expectParseConverged(doc);
	});
});

describe('separator settle inside a strip container', () => {
	beforeEach(activateDirectiveGrammar);

	// Non-vacuity for the wrap gate: a blockquote body opens at the container's own first line,
	// so nothing peels and the settle must DROP the separator it frees.
	it('drops the freed separator — a blockquote peels nothing', () => {
		const doc = parse('> a\n>\n>\n> b\n');

		deleteNode(bodyParentOf(doc.children[0]), 2);
		rebuildAncestryRaw(doc.children[0], []);

		expect(doc.children[0].innerPrefix).toBe('');
		expect(serialize(doc)).toBe('> a\n>\n>\n');
		expectParseConverged(doc);
	});
});

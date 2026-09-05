/**
 * U1 and the empty-item exit partition an item's children by one promote/lift rule, so a
 * matching-ordered sublist with no items must land the same way in both and keep its bytes,
 * in either representation of childless. Miss-analysis: each entry path was tested alone, so
 * the two dispositions of one shape were never compared as a class.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { buildExitReplacement, unwrapFirstItemFromList } from '$lib/tree-operations';
import type { CstNode } from '$lib/core/nodes';

const GHOST_RAW = '1. ghost\n';

// ── Fixture ────────────────────────────────────────────────────────────────

/** An ordered list whose first item holds an ordered sublist carrying bytes but no items. */
function listWithEmptySublist(sublistChildren: CstNode[] | undefined): CstNode {
	const doc = parse(`1. First\n   ${GHOST_RAW}`);
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	const sublist = list.children![0].children![1];
	if (sublist.kind !== 'list') {
		throw new Error(`expected nested list, got ${sublist.kind}`);
	}
	sublist.children = sublistChildren;
	return list;
}

/** The exit fires from a user-empty item, so the exiting paragraph carries no content. */
function blankFirstParagraph(list: CstNode): CstNode {
	list.children![0].children![0].raw = '\n';
	return list;
}

const serializeBlocks = (blocks: CstNode[]): string =>
	serialize({ children: blocks, prefix: '', suffix: '' });

const sublistIn = (blocks: CstNode[]): CstNode | undefined =>
	blocks.find((block) => block.kind === 'list' && block.raw === GHOST_RAW);

// ── Parity ─────────────────────────────────────────────────────────────────

const CHILDLESS_SHAPES = [
	{ label: 'children: undefined', childrenOf: (): CstNode[] | undefined => undefined },
	{ label: 'children: []', childrenOf: (): CstNode[] | undefined => [] }
];

describe.each(CHILDLESS_SHAPES)('matching-ordered sublist with $label', ({ childrenOf }) => {
	const fixture = () => listWithEmptySublist(childrenOf());

	it('unwrap (U1) lifts it as a top-level block, bytes intact', () => {
		const blocks = unwrapFirstItemFromList(fixture());

		expect(sublistIn(blocks)).toBeDefined();
		expect(serializeBlocks(blocks)).toContain(GHOST_RAW);
	});

	it('exit lifts it as a top-level block, bytes intact', () => {
		const { blocks } = buildExitReplacement(blankFirstParagraph(fixture()), 0);

		expect(sublistIn(blocks)).toBeDefined();
		expect(serializeBlocks(blocks)).toContain(GHOST_RAW);
	});

	it('both entry points give it the same disposition', () => {
		const unwrapped = unwrapFirstItemFromList(fixture());
		const exited = buildExitReplacement(blankFirstParagraph(fixture()), 0).blocks;

		expect(sublistIn(unwrapped)).toBeDefined();
		expect(sublistIn(exited)?.raw).toBe(sublistIn(unwrapped)?.raw);
	});
});

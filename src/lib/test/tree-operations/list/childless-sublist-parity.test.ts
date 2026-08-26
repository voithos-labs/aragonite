/**
 * U1 and the empty-item exit partition an item's children by one promote/lift rule, so a
 * matching-ordered sublist with `children: undefined` must land the same way in both and
 * keep its bytes. Miss-analysis: each entry path was tested alone, so the two dispositions
 * of one shape were never compared as a class.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { buildExitReplacement, unwrapFirstItemFromList } from '$lib/tree-operations';
import type { CstNode } from '$lib/core/nodes';

// ── Fixture ────────────────────────────────────────────────────────────────

/** An ordered list whose first item holds a childless ordered sublist carrying real bytes. */
function listWithChildlessSublist(): CstNode {
	const doc = parse('1. First\n   1. ghost\n');
	const list = doc.children[0];
	if (list?.kind !== 'list') {
		throw new Error(`expected list, got ${list?.kind}`);
	}
	const sublist = list.children![0].children![1];
	if (sublist.kind !== 'list') {
		throw new Error(`expected nested list, got ${sublist.kind}`);
	}
	sublist.children = undefined;
	return list;
}

/** The exit fires from a user-empty item, so the exiting paragraph carries no content. */
function blankFirstParagraph(list: CstNode): CstNode {
	list.children![0].children![0].raw = '\n';
	return list;
}

const serializeBlocks = (blocks: CstNode[]): string =>
	serialize({ children: blocks, prefix: '', suffix: '' });

const childlessSublistIn = (blocks: CstNode[]): CstNode | undefined =>
	blocks.find((block) => block.kind === 'list' && block.children === undefined);

// ── Parity ─────────────────────────────────────────────────────────────────

describe('childless matching-ordered sublist', () => {
	it('unwrap (U1) lifts it as a top-level block, bytes intact', () => {
		const blocks = unwrapFirstItemFromList(listWithChildlessSublist());

		expect(childlessSublistIn(blocks)?.raw).toBe('1. ghost\n');
		expect(serializeBlocks(blocks)).toContain('1. ghost\n');
	});

	it('exit lifts it as a top-level block, bytes intact', () => {
		const { blocks } = buildExitReplacement(blankFirstParagraph(listWithChildlessSublist()), 0);

		expect(childlessSublistIn(blocks)?.raw).toBe('1. ghost\n');
		expect(serializeBlocks(blocks)).toContain('1. ghost\n');
	});

	it('both entry points give it the same disposition', () => {
		const unwrapped = unwrapFirstItemFromList(listWithChildlessSublist());
		const exited = buildExitReplacement(blankFirstParagraph(listWithChildlessSublist()), 0).blocks;

		expect(childlessSublistIn(unwrapped)?.raw).toBe(childlessSublistIn(exited)?.raw);
	});
});

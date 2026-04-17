/**
 * Isolation tests for the "Paste into cross-list-item selection does nothing"
 * bug (see docs/issues.md). These drive the pure layers — rangeDelete plus
 * the raw mutation + ancestry rebuild that handlePaste performs — so we can
 * tell where the pipeline breaks independent of Svelte reactivity.
 */

import { describe, it, expect } from 'vitest';
import { rangeDelete } from '../../selection/range-delete';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { nodeAt } from '../../tree-operations/node-ops';
import { rebuildContainerRawIfContainer } from '../../tree-operations/container-raw';
import { trimTrailingLineEnding } from '../../core/lines';
import type { CstNode } from '../../core/nodes';

function rebuildAncestryForLeaf(doc: Parameters<typeof nodeAt>[0], leafPath: number[]): void {
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, leafPath.slice(0, depth));
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildContainerRawIfContainer(ancestor as CstNode);
	}
}

describe('intra-list cross-item paste pipeline', () => {
	it('rangeDelete on "1. one" ↔ "2. two" collapses to a single list item with empty paragraph', () => {
		const doc = parse('1. one\n2. two\n');
		const { collapsedCaret } = rangeDelete(
			doc,
			{ path: [0, 0, 0], offset: 0 },
			{ path: [0, 1, 0], offset: 3 }
		);
		expect(serialize(doc)).toBe('1. \n');
		expect(collapsedCaret).toEqual({ path: [0, 0, 0], offset: 0 });
	});

	it('after rangeDelete, splicing paste text into the caret leaf and rebuilding ancestors produces the pasted content inside the list', () => {
		const doc = parse('1. one\n2. two\n');
		const { collapsedCaret } = rangeDelete(
			doc,
			{ path: [0, 0, 0], offset: 0 },
			{ path: [0, 1, 0], offset: 3 }
		);
		const pasted = 'HELLO';
		const targetNode = nodeAt(doc, collapsedCaret.path) as CstNode;
		const display = trimTrailingLineEnding(targetNode.raw);
		const lineEnding = targetNode.raw.endsWith('\r\n') ? '\r\n' : '\n';
		targetNode.raw =
			display.slice(0, collapsedCaret.offset) +
			pasted +
			display.slice(collapsedCaret.offset) +
			lineEnding;
		rebuildAncestryForLeaf(doc, collapsedCaret.path);
		expect(serialize(doc)).toBe('1. HELLO\n');
	});
});

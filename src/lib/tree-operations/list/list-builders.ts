/**
 * Shared builders for list / list-item construction used by Enter-exit and
 * paste flows. Three near-identical copies (`exit-replacement`, `paste/list-absorb`,
 * `paste/list-break-out`) collapsed here so split/renumber/marker-suffix
 * behavior cannot drift between paths.
 */

import type { CstNode, Document } from '../../core/nodes';
import { trimTrailingLineEnding } from '../../core/lines';
import { parse } from '../../core/parser';
import { nodeAt } from '../node-ops';
import { rebuildListItemRaw, rebuildListRaw } from '../../schema/container-raw';
import { renumberOrderedList } from './ordered-markers';

// ── List / item construction ─────────────────────────────────────────────────

/**
 * Construct a list CST node carrying `items`, mirroring `template`'s metadata
 * and inner-prefix/suffix. Renumbers ordered markers starting at `startNumber`
 * (no-op for unordered lists). Items are mutated in place — pass clones if
 * the caller needs to preserve originals.
 */
export function buildListHalf(template: CstNode, items: CstNode[], startNumber: number): CstNode {
	const half: CstNode = {
		kind: 'list',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata ? { ...template.metadata } : { ordered: false },
		children: items,
		innerPrefix: template.innerPrefix ?? '',
		innerSuffix: template.innerSuffix ?? ''
	};
	if (items[0]) items[0].leadingTrivia = '';
	for (const item of items) rebuildListItemRaw(item);

	// renumberOrderedList's fromIndex=0 path always restarts at 1 — seed
	// items[0] manually to renumber from an arbitrary base.
	const ordered = (half.metadata as { ordered?: boolean } | undefined)?.ordered ?? false;
	if (ordered && items.length > 0) {
		const firstMeta = items[0].metadata as { marker: string };
		const suffix = firstMeta.marker.replace(/^\d+/, '') || '. ';
		firstMeta.marker = String(startNumber) + suffix;
		rebuildListItemRaw(items[0]);
		renumberOrderedList(half, 1);
	}
	rebuildListRaw(half);
	return half;
}

/**
 * Construct a listItem mirroring `template`'s metadata/affixes around the
 * provided children. `children` are placed verbatim — clone before passing
 * if they are still referenced from the source tree.
 */
export function buildListItemWithContent(template: CstNode, children: CstNode[]): CstNode {
	const item: CstNode = {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: template.metadata ? { ...template.metadata } : { marker: '- ' },
		innerPrefix: template.innerPrefix ?? '',
		children,
		innerSuffix: template.innerSuffix ?? ''
	};
	if (children[0]) children[0].leadingTrivia = '';
	rebuildListItemRaw(item);
	return item;
}

// ── Marker helpers ───────────────────────────────────────────────────────────

/** Read an item's marker as an integer base, defaulting to 1 for non-numeric markers. */
export function orderedBaseOf(item: CstNode | undefined): number {
	if (!item) return 1;
	const marker = (item.metadata as { marker?: string } | undefined)?.marker ?? '';
	const n = parseInt(marker, 10);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Read the punctuation suffix (`. ` or `) `) from a list's first item.
 * Defaults to `. ` when the list is empty or the first item lacks a marker.
 */
export function readOrderedSuffix(list: CstNode): string {
	const first = list.children?.[0];
	if (!first) return '. ';
	const marker = (first.metadata as { marker?: string } | undefined)?.marker ?? '1. ';
	return marker.replace(/^\d+/, '') || '. ';
}

// ── Parse helpers ────────────────────────────────────────────────────────────

/** Parse `raw` and return its first block, falling back to a paragraph node. */
export function parseFirstBlock(raw: string): CstNode {
	const doc = parse(raw);
	if (doc.children.length > 0) return doc.children[0];
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

/**
 * Slice a leaf's raw at `offset`, returning the leading and trailing halves
 * as freshly-parsed CST nodes (or null when a side is empty). Trims one
 * leading whitespace character from the trailing slice so word-boundary
 * splits don't serialize with a double-space marker. Detected line ending
 * is reported for callers that need to re-terminate.
 */
export function splitLeafRawAtCaret(
	leaf: CstNode,
	offset: number
): { leadingNode: CstNode | null; trailingNode: CstNode | null; lineEnding: '\n' | '\r\n' } {
	const lineEnding: '\n' | '\r\n' = leaf.raw.endsWith('\r\n') ? '\r\n' : '\n';
	const display = trimTrailingLineEnding(leaf.raw);
	const leadingText = display.slice(0, offset);
	const trailingText = display.slice(offset).replace(/^[ \t]/, '');

	const leadingNode = leadingText.length > 0 ? parseFirstBlock(leadingText + lineEnding) : null;
	const trailingNode = trailingText.length > 0 ? parseFirstBlock(trailingText + lineEnding) : null;

	return { leadingNode, trailingNode, lineEnding };
}

// ── Ancestor walk ────────────────────────────────────────────────────────────

/**
 * Walk up from `targetPath` to the nearest enclosing list. Returns null when
 * no list ancestor exists or when the target isn't a direct leaf of a
 * listItem (the simple shape both paste paths require).
 */
export function findEnclosingListForPaste(
	doc: Document,
	targetPath: number[]
): { list: CstNode; listPath: number[]; itemIndex: number; innerIndex: number } | null {
	if (targetPath.length < 3) return null;

	let listDepth = -1;
	let list: CstNode | null = null;
	for (let depth = targetPath.length - 1; depth >= 1; depth--) {
		const ancestor = nodeAt(doc, targetPath.slice(0, depth)) as CstNode | null;
		if (!ancestor) return null;
		if (ancestor.kind === 'list') {
			listDepth = depth;
			list = ancestor;
			break;
		}
	}
	if (listDepth === -1 || !list) return null;
	if (targetPath.length !== listDepth + 2) return null;

	return {
		list,
		listPath: targetPath.slice(0, listDepth),
		itemIndex: targetPath[listDepth],
		innerIndex: targetPath[listDepth + 1]
	};
}

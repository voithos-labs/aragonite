/**
 * Cross-block clipboard text collection. Walks the CST between two
 * selection endpoints and assembles the plain-text slice, promoting
 * leaf endpoints to container ancestors when the boundary falls at a
 * full-content edge so structural formatting is preserved.
 */

import type { SelectionPoint } from './selection-types';
import type { CstNode, Document } from '../core/nodes';
import { nodeAt } from './path-lookup';
import { walkBetween } from './range-walker';
import { normalize } from './selection-point';
import { displayLength } from '../raw-text';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Collect the plain-text content spanning a cross-block selection. Includes
 * the tail of the start block's raw, the full leadingTrivia + raw of every
 * middle block, and the head of the end block's raw.
 *
 * walkBetween yields ALL paths (containers AND their children). A container's
 * raw already includes its children's text, so collecting both would duplicate
 * content. We skip descendants of already-collected containers, and also skip
 * ancestors of the start/end paths (those are handled by the partial
 * tail/head slicing).
 *
 * When an endpoint is a leaf inside a container (e.g. a paragraph inside a
 * list item) and the selection includes the full leaf boundary (offset 0 for
 * start, displayLength for end), we promote to the deepest non-shared
 * container ancestor so that structural formatting (list markers, blockquote
 * prefixes) is preserved in the clipboard text.
 */
export function collectCrossBlockText(
	doc: Document,
	anchor: SelectionPoint,
	focus: SelectionPoint
): string {
	const { start, end } = normalize({ anchor, focus });
	const startNode = nodeAt(doc, start.path);
	const endNode = nodeAt(doc, end.path);
	if (!startNode || !endNode) return '';

	const startRaw = 'raw' in startNode ? (startNode as CstNode).raw : '';
	const endRaw = 'raw' in endNode ? (endNode as CstNode).raw : '';

	// Promote start/end to container ancestors when at full-boundary offsets,
	// so structural formatting (list markers, blockquote prefixes) is included.
	let effectiveStartPath = start.path;
	let startTail: string;
	if (start.offset === 0 && start.path.length > 1) {
		const promoted = promoteToContainer(doc, start.path, end.path, 'start');
		if (promoted) {
			effectiveStartPath = promoted.path;
			startTail = promoted.raw;
		} else {
			startTail = startRaw.slice(start.offset);
		}
	} else {
		startTail = startRaw.slice(start.offset);
	}

	let effectiveEndPath = end.path;
	let endHead: string;
	if (end.offset === displayLength(endRaw) && end.path.length > 1) {
		const promoted = promoteToContainer(doc, end.path, start.path, 'end');
		if (promoted) {
			effectiveEndPath = promoted.path;
			endHead = promoted.raw;
		} else {
			endHead = endRaw.slice(0, end.offset);
		}
	} else {
		endHead = endRaw.slice(0, end.offset);
	}

	let middle = '';
	const collectedContainers: number[][] = [];

	for (const path of walkBetween(doc, effectiveStartPath, effectiveEndPath)) {
		// Skip ancestors of either endpoint
		if (isStrictAncestorOf(path, effectiveStartPath)) continue;
		if (isStrictAncestorOf(path, effectiveEndPath)) continue;

		// Skip descendants of promoted endpoints — their text is already in
		// startTail / endHead via the container's raw
		if (isStrictAncestorOf(effectiveStartPath, path)) continue;
		if (isStrictAncestorOf(effectiveEndPath, path)) continue;

		if (collectedContainers.some((cp) => isStrictAncestorOf(cp, path))) continue;

		const node = nodeAt(doc, path);
		if (!node || !('raw' in node)) continue;
		const lead = 'leadingTrivia' in node ? (node as CstNode).leadingTrivia : '';
		middle += lead + (node as CstNode).raw;

		if (node.children && node.children.length > 0) {
			collectedContainers.push(path);
		}
	}
	return startTail + middle + endHead;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Walk up from a leaf endpoint, promoting to the deepest container ancestor
 * whose content is entirely within the selection scope. For the start side,
 * promotion is safe only while the child at each level is the first child
 * (no earlier siblings to accidentally include). For the end side, only while
 * the child is the last.
 */
function promoteToContainer(
	doc: Document,
	leafPath: number[],
	otherPath: number[],
	side: 'start' | 'end'
): { path: number[]; raw: string } | null {
	const lcaDepth = sharedPrefixLength(leafPath, otherPath);

	let bestPath: number[] | null = null;

	for (let depth = leafPath.length - 1; depth > lcaDepth; depth--) {
		const parentPath = leafPath.slice(0, depth);
		const parent = nodeAt(doc, parentPath);
		if (!parent || !parent.children) break;

		const childIndex = leafPath[depth];

		if (side === 'start' && childIndex !== 0) break;
		if (side === 'end' && childIndex !== parent.children.length - 1) break;

		bestPath = parentPath;
	}

	if (!bestPath || bestPath.length <= lcaDepth) return null;
	const node = nodeAt(doc, bestPath);
	if (!node || !('raw' in node)) return null;
	return { path: bestPath, raw: (node as CstNode).raw };
}

/** Number of shared leading indices between two paths. */
function sharedPrefixLength(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) return i;
	}
	return len;
}

/** True if `ancestor` is a strict prefix of `descendant`'s path. */
function isStrictAncestorOf(ancestor: number[], descendant: number[]): boolean {
	if (ancestor.length >= descendant.length) return false;
	for (let i = 0; i < ancestor.length; i++) {
		if (ancestor[i] !== descendant[i]) return false;
	}
	return true;
}

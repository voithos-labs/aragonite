/**
 * Cross-block clipboard text collection.
 */

import type { SelectionPoint } from './primitives';
import type { CstNode, Document } from '../core/nodes';
import { nodeAt } from '../tree-operations/node-ops';
import { walkBetween, normalize } from './primitives';
import { displayLength } from '../core/lines';

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Collect the plain-text content spanning a cross-block selection. Includes
 * the tail of the start block's raw, the full leadingTrivia + raw of every
 * middle block, and the head of the end block's raw.
 *
 * walkBetween yields containers AND their children; a container's raw already
 * includes its children's text, so we skip descendants of already-collected
 * containers to avoid duplication.
 *
 * Leaf endpoints at full-boundary offsets promote to their deepest non-shared
 * container ancestor so structural formatting (list markers, blockquote
 * prefixes) is preserved.
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
	} else if (start.offset > 0 && start.path.length > 1) {
		startTail =
			startPartialWithContainerMarker(doc, start, startRaw) ?? startRaw.slice(start.offset);
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
	} else if (end.offset > 0 && end.offset < displayLength(endRaw) && end.path.length > 1) {
		endHead = endPartialWithContainerMarker(doc, end, endRaw) ?? endRaw.slice(0, end.offset);
	} else {
		endHead = endRaw.slice(0, end.offset);
	}

	let middle = '';
	const collectedContainers: number[][] = [];

	for (const path of walkBetween(doc, effectiveStartPath, effectiveEndPath)) {
		if (isStrictAncestorOf(path, effectiveStartPath)) continue;
		if (isStrictAncestorOf(path, effectiveEndPath)) continue;
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

	// Without the end node's leadingTrivia, blank lines between paragraphs get
	// dropped and paste reparses as a single merged paragraph. Skip when
	// start/end resolved to the same effective path (endHead === startTail).
	let endLead = '';
	if (!pathsEqual(effectiveStartPath, effectiveEndPath)) {
		const endNode = nodeAt(doc, effectiveEndPath);
		if (endNode && 'leadingTrivia' in endNode) {
			endLead = (endNode as CstNode).leadingTrivia;
		}
	}

	return startTail + middle + endLead + endHead;
}

function pathsEqual(a: number[], b: number[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

// ── Internal ───────────────────────────────────────────────────────────────

/**
 * Mirror of {@link endPartialWithContainerMarker} for the start endpoint.
 * Without the container marker, CommonMark §5.2 prevents subsequent "N."
 * lines from interrupting the paragraph, collapsing the round-trip into a
 * single multi-line block.
 */
function startPartialWithContainerMarker(
	doc: Document,
	start: SelectionPoint,
	startRaw: string
): string | null {
	const parentPath = start.path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !('children' in parent) || !parent.children) return null;
	if (parent.kind !== 'listItem' && parent.kind !== 'blockquote') return null;

	if (parent.children.length !== 1) return null;
	if (start.path[start.path.length - 1] !== 0) return null;

	const parentRaw = (parent as CstNode).raw;
	if (!parentRaw.endsWith(startRaw)) return null;

	const prefix = parentRaw.slice(0, parentRaw.length - startRaw.length);
	return prefix + startRaw.slice(start.offset);
}

/**
 * Prepend the container marker to a partial leaf slice when the leaf is the
 * sole child of a listItem / blockquote, so the clipboard retains structural
 * formatting (e.g. "3. thi" rather than "thi"). Returns null when the
 * container isn't eligible; callers fall back to the plain leaf slice.
 */
function endPartialWithContainerMarker(
	doc: Document,
	end: SelectionPoint,
	endRaw: string
): string | null {
	const parentPath = end.path.slice(0, -1);
	const parent = nodeAt(doc, parentPath);
	if (!parent || !('children' in parent) || !parent.children) return null;
	if (parent.kind !== 'listItem' && parent.kind !== 'blockquote') return null;

	// Prefix recovery requires the leaf be the sole child — otherwise earlier
	// siblings' text sits between the marker and the leaf's raw.
	if (parent.children.length !== 1) return null;
	if (end.path[end.path.length - 1] !== 0) return null;

	const parentRaw = (parent as CstNode).raw;
	if (!parentRaw.endsWith(endRaw)) return null;

	const prefix = parentRaw.slice(0, parentRaw.length - endRaw.length);
	return prefix + endRaw.slice(0, end.offset);
}

/**
 * Walk up from a leaf endpoint, promoting to the deepest container ancestor
 * whose content is entirely within the selection scope. Start-side promotion
 * is safe only while each child is the first; end-side, only while last.
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

/**
 * Core range mutation primitive. Takes a Document and a normalized range
 * ({start, end}) and mutates the document: truncate start block, truncate
 * end block, delete everything between, re-parse merged raw, cascade-clean
 * empty ancestors, and rebuild container raw up each affected ancestor
 * chain. Caller must normalize the range before calling.
 *
 * Used by cross-block Cut, Paste, Backspace, Delete, and type-replace.
 * See docs/superpowers/specs/2026-04-15-v0.4-selection-clipboard-design.md
 * Range Mutations section for the full algorithm and "start wins" semantics.
 */

import type { CstNode, Document } from '../core/nodes';
import type { SelectionPoint } from './selection-types';
import { parse } from '../core/parser';
import { walkBetween } from './range-walker';
import { comparePaths } from './selection-point';
import { cascadeCleanupEmptyAncestors } from '../tree-operations/cleanup';
import {
	rebuildBlockquoteRaw,
	rebuildListRaw,
	rebuildListItemRaw
} from '../tree-operations/container-raw';

// ── Public API ──────────────────────────────────────────────────────────────

export interface RangeDeleteResult {
	newDoc: Document;
	collapsedCaret: SelectionPoint;
}

/**
 * Delete the range [start, end] from `doc`, merge the endpoint blocks at
 * start's position with start's container context preserved, cascade-clean
 * empty ancestors of deleted blocks, and rebuild container raw along every
 * ancestor chain that touched a mutation. Returns the mutated `doc`
 * (mutated in place — the parameter and `newDoc` reference the same
 * object) and the collapsed caret position inside the merged block.
 *
 * Caller must ensure `start` and `end` are normalized (start <= end in doc
 * order) via `selection-point.normalize`. Caller must also ensure neither
 * endpoint lands on a non-focusable block.
 */
export function rangeDelete(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint
): RangeDeleteResult {
	const startBlock = nodeAt(doc, start.path);
	const endBlock = nodeAt(doc, end.path);
	if (!startBlock || !endBlock) {
		throw new Error('rangeDelete: start or end path does not resolve to a node');
	}

	const sameBlock = comparePaths(start.path, end.path) === 0;

	// 1. Truncate and merge raw text.
	const startRaw = (startBlock as CstNode).raw;
	const endRaw = (endBlock as CstNode).raw;
	const startHead = startRaw.slice(0, start.offset);
	const endTail = endRaw.slice(end.offset);
	const mergedRaw = startHead + endTail;

	// 2. Re-parse merged raw. May produce 0, 1, or more blocks.
	const reparsed = parse(mergedRaw || '\n');
	const replacement: CstNode[] =
		reparsed.children.length > 0
			? reparsed.children
			: [{ kind: 'paragraph', leadingTrivia: '', raw: '\n' }];

	if (sameBlock) {
		// Same-block: overwrite raw directly. No deletion, no cascade cleanup.
		// Still need to rebuild ancestor container raws — this block may be
		// nested inside a blockquote/list/listItem whose serialized form
		// depends on its descendants' raws.
		(startBlock as CstNode).raw = mergedRaw;
		rebuildAncestryContainerRaw(doc, start.path);
		return {
			newDoc: doc,
			collapsedCaret: { path: start.path.slice(), offset: start.offset }
		};
	}

	// 3. Collect deletion targets: every path strictly between start and end,
	//    plus end.path itself. We don't delete start.path — its node is replaced
	//    by the merged block(s) below.
	const betweenPaths = walkBetween(doc, start.path, end.path);
	const deletionPaths: number[][] = [...betweenPaths, end.path];

	// 4. Find the lowest common ancestor of start and end. Cascade cleanup
	//    will not walk above this path.
	const lcaPath = lowestCommonAncestor(start.path, end.path);

	// 5. Apply deletions in REVERSE document order (deepest/latest first) so
	//    earlier paths are not invalidated mid-iteration.
	const reverseSortedDeletions = deletionPaths.slice().sort((a, b) => comparePaths(b, a));
	for (const path of reverseSortedDeletions) {
		deleteAtPath(doc, path);
	}

	// 6. Replace startBlock with the re-parsed replacement blocks.
	replaceAtPath(doc, start.path, replacement);

	// 7. Cascade cleanup. For each deleted path, walk from its parent up
	//    toward the LCA, removing containers that became empty.
	for (const path of deletionPaths) {
		cascadeCleanupEmptyAncestors(doc, path, lcaPath);
	}

	// 8. Rebuild container raws along every mutated chain. Start-path ancestors
	//    need it because the replacement block changed the container's raw;
	//    deleted-path ancestors need it because their children arrays shrank
	//    (and cascade-cleanup may have removed intermediate containers).
	rebuildAncestryContainerRaw(doc, start.path);
	for (const path of deletionPaths) {
		rebuildAncestryContainerRaw(doc, path);
	}

	// 9. Compute the caret position. For replacement.length === 1, the caret
	//    is at start.offset of the merged block at start.path. For N > 1
	//    (rare), caret lands in the first replacement block — still at
	//    start.path with start.offset, since replacement[0] takes that slot.
	const collapsedCaret: SelectionPoint = {
		path: start.path.slice(),
		offset: start.offset
	};
	return { newDoc: doc, collapsedCaret };
}

// ── Internal helpers ────────────────────────────────────────────────────────

function nodeAt(doc: Document, path: number[]): CstNode | Document | null {
	let cur: CstNode | Document = doc;
	for (const idx of path) {
		if (!cur.children || idx >= cur.children.length) return null;
		cur = cur.children[idx];
	}
	return cur;
}

function deleteAtPath(doc: Document, path: number[]): void {
	if (path.length === 0) return; // Can't delete the root.
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	if (idx < parent.children.length) {
		parent.children.splice(idx, 1);
	}
}

function replaceAtPath(doc: Document, path: number[], replacement: CstNode[]): void {
	if (path.length === 0) return;
	const parent = nodeAt(doc, path.slice(0, -1));
	if (!parent || !parent.children) return;
	const idx = path[path.length - 1];
	parent.children.splice(idx, 1, ...replacement);
}

function lowestCommonAncestor(a: number[], b: number[]): number[] {
	const result: number[] = [];
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] !== b[i]) break;
		result.push(a[i]);
	}
	return result;
}

/**
 * Rebuild `raw` for every container ancestor of `leafPath`, innermost-first.
 * The document root is never rebuilt (serialization reads children directly).
 * Missing ancestors (e.g., removed by cascade cleanup) short-circuit the walk.
 */
function rebuildAncestryContainerRaw(doc: Document, leafPath: number[]): void {
	// Walk from the deepest ancestor (leafPath.length - 1) down to the shallowest (1).
	// Stopping at length 1 means ancestorPath = [idx], i.e. a direct child of
	// document root — that node may itself be a container whose raw needs rebuild.
	for (let depth = leafPath.length - 1; depth >= 1; depth--) {
		const ancestorPath = leafPath.slice(0, depth);
		const ancestor = nodeAt(doc, ancestorPath);
		if (!ancestor || !('kind' in ancestor)) break;
		rebuildIfContainer(ancestor as CstNode);
	}
}

function rebuildIfContainer(node: CstNode): void {
	switch (node.kind) {
		case 'blockquote':
			rebuildBlockquoteRaw(node);
			return;
		case 'list':
			rebuildListRaw(node);
			return;
		case 'listItem':
			rebuildListItemRaw(node);
			return;
		default:
			// Leaf or unknown — nothing to rebuild.
			return;
	}
}

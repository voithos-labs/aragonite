/**
 * Cross-block mutation operations. Delete a range, push undo, collapse, and
 * restore the native caret in the merged block.
 *
 * Two commit paths:
 *   - Pure top-level (both endpoints at doc.children) → commitStructural.
 *   - Cross-container (at least one endpoint nested) → commitMultiScope
 *     with one scope per touched container, so every affected
 *     BlockListState stays in sync with node.children.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { CstNode, Document } from '../core/nodes';
import type { MultiScopeTarget, UndoController } from '../editor-actions/deps';
import { applyCollapsedCaret } from './native-bridge';
import { rangeDelete } from './range-delete';
import type { StructuralChange } from '../tree-operations/structural-change';
import { nodeAt } from '../tree-operations/node-ops';
import { getStateForNode } from '../state-registry';
import type { BlockListState } from '../block-list-state.svelte';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	controller: UndoController;
	/** Push an undo snapshot immediately, bypassing the debounce. */
	pushUndoSnapshot: () => void;
	/** Trigger top-level reactivity (sync variant and legacy paths). */
	notifyDocMutated: () => void;
}

/**
 * Run rangeDelete on the current cross-block selection, commit via the
 * controller, collapse, and restore the native caret. Returns the
 * collapsed caret position, or null if the selection wasn't cross-block.
 *
 * `skipSnapshot`: caller already pushed a snapshot covering this delete.
 * `skipCaretRestore`: caller will install a final caret after further
 * mutations.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: { skipSnapshot?: boolean; skipCaretRestore?: boolean }
): Promise<SelectionPoint | null> {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	const doc = ctx.getDoc();
	const isPureTopLevel = start.path.length === 1 && end.path.length === 1;

	const caretRestore = !options?.skipCaretRestore
		? (caret: SelectionPoint | null) => {
				if (caret) {
					const blockEl = ctx.getBlockElByPath(caret.path);
					if (blockEl) {
						applyCollapsedCaret(blockEl, caret);
						blockEl.focus();
					}
				}
			}
		: undefined;

	if (isPureTopLevel) {
		return await commitPureTopLevelDelete(ctx, start, end, options, caretRestore);
	}
	return await commitCrossContainerDelete(ctx, doc, start, end, options, caretRestore);
}

/**
 * Synchronous variant for compositionstart — no await, no caret restore.
 * compositionstart handlers cannot await (the IME swallows the composition
 * if we yield), so this stays on the legacy snapshot + mutate + notify path.
 * The IME composition bracket hides any transient innerBlockIds/children
 * desync until compositionend re-renders from the post-mutation CST.
 */
export function performCrossBlockDeleteSync(ctx: CrossBlockMutationContext): SelectionPoint | null {
	const { start, end } = resolveStartEnd(ctx.selection);
	if (!start || !end) return null;

	ctx.pushUndoSnapshot();
	const { collapsedCaret } = rangeDelete(ctx.getDoc(), start, end);
	ctx.selection.collapse();
	ctx.notifyDocMutated();
	return collapsedCaret;
}

// ── Internal ───────────────────────────────────────────────────────────────

function resolveStartEnd(selection: SelectionState): {
	start: SelectionPoint | null;
	end: SelectionPoint | null;
} {
	if (!selection.isCrossBlock) return { start: null, end: null };
	return { start: selection.start, end: selection.end };
}

/**
 * Pure top-level commit path. Both paths have length 1, so rangeDelete
 * never reaches into a nested container and the proxy-doc (children copy)
 * is a safe mutation target.
 */
async function commitPureTopLevelDelete(
	ctx: CrossBlockMutationContext,
	start: SelectionPoint,
	end: SelectionPoint,
	options: { skipSnapshot?: boolean } | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	let collapsedCaret: SelectionPoint | null = null;

	await ctx.controller.commitStructural(
		start.path[0],
		start.offset,
		(topLevelChildren) => {
			const proxyDoc = { children: topLevelChildren } as Document;
			const beforeLen = topLevelChildren.length;
			const result = rangeDelete(proxyDoc, start, end);
			collapsedCaret = result.collapsedCaret;
			const afterLen = topLevelChildren.length;
			ctx.selection.collapse();
			return topLevelStructuralChange(start.path, end.path, beforeLen, afterLen);
		},
		caretRestore ? () => caretRestore(collapsedCaret) : undefined,
		{
			skipSnapshot: options?.skipSnapshot,
			op: { kind: 'delete', detail: { crossBlock: true } }
		}
	);

	return collapsedCaret;
}

/**
 * Cross-container commit path. Runs rangeDelete once on the live doc inside
 * a commitMultiScope whose scope list covers every container whose children
 * array was spliced. After mutation, each scope's children copy is
 * splice-synced to the live state so commitMultiScope can publish it and
 * run the StructuralChange descriptor against innerBlockIds/innerBlockRefs.
 */
async function commitCrossContainerDelete(
	ctx: CrossBlockMutationContext,
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	options: { skipSnapshot?: boolean } | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const touched = collectTouchedContainers(doc, start.path, end.path);
	const scopes: MultiScopeTarget[] = [];
	const containerPaths: number[][] = [];

	// Doc scope goes first when the LCA is doc-level, so commitMultiScope
	// publishes doc.children / blockIds / blockRefs atomically with the
	// container scopes.
	const lcaIsDocRoot = start.path[0] !== end.path[0];
	if (lcaIsDocRoot) {
		scopes.push(ctx.controller.getDocScope());
		containerPaths.push([]);
	}

	for (const t of touched) {
		scopes.push({ node: t.node, state: t.state });
		containerPaths.push(t.path);
	}

	let collapsedCaret: SelectionPoint | null = null;

	await ctx.controller.commitMultiScope(
		scopes,
		options?.skipSnapshot ? 'skip' : { blockIndex: start.path[0], offset: start.offset },
		(scopeChildren) => {
			// Read lengths by node reference BEFORE mutation. Paths go stale
			// as rangeDelete splices (middle top-level block shifts indices);
			// node references stay valid because splices happen in place.
			const beforeLens = scopes.map((s) => s.node.children?.length ?? 0);

			const result = rangeDelete(doc, start, end);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();

			// Splice-in-place the copy to match live post-mutation children.
			// The copy is the same array reference commitMultiScope will
			// publish back to node.children.
			for (let i = 0; i < scopes.length; i++) {
				const liveChildren = scopes[i].node.children ?? [];
				const copy = scopeChildren[i].children;
				copy.splice(0, copy.length, ...liveChildren);
			}

			return containerPaths.map((p, i) =>
				computeScopeDescriptor(
					p,
					start.path,
					end.path,
					beforeLens[i],
					scopeChildren[i].children.length
				)
			);
		},
		{ kind: 'delete', detail: { crossBlock: true }, eventPath: [start.path[0]] },
		caretRestore ? () => caretRestore(collapsedCaret) : undefined
	);

	return collapsedCaret;
}

/**
 * Enumerate every mounted container on start.path or end.path (strictly
 * above the endpoint) whose children array gets spliced. Document root is
 * excluded; callers add it via `getDocScope()`. Returned outermost-first,
 * de-duplicated when start and end share ancestors.
 */
function collectTouchedContainers(
	doc: Document,
	startPath: number[],
	endPath: number[]
): Array<{ path: number[]; node: CstNode; state: BlockListState }> {
	const touched: Array<{
		path: number[];
		node: CstNode;
		state: BlockListState;
	}> = [];
	const seen = new Set<string>();

	function visit(leafPath: number[]): void {
		for (let depth = 1; depth < leafPath.length; depth++) {
			const ancestorPath = leafPath.slice(0, depth);
			const key = ancestorPath.join('.');
			if (seen.has(key)) continue;
			seen.add(key);
			const node = nodeAt(doc, ancestorPath);
			if (!node || !('kind' in node) || !node.children) continue;
			const state = getStateForNode(node as CstNode);
			if (!state) continue;
			touched.push({ path: ancestorPath, node: node as CstNode, state });
		}
	}

	visit(startPath);
	visit(endPath);

	touched.sort((a, b) => {
		if (a.path.length !== b.path.length) return a.path.length - b.path.length;
		for (let i = 0; i < a.path.length; i++) {
			if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
		}
		return 0;
	});
	return touched;
}

function pathHasPrefix(path: number[], prefix: number[]): boolean {
	if (prefix.length > path.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (path[i] !== prefix[i]) return false;
	}
	return true;
}

/** Exported for unit tests; internal-only — do not import outside test/. */
export function __computeScopeDescriptorForTests(
	ancestorPath: number[],
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	return computeScopeDescriptor(ancestorPath, startPath, endPath, beforeLen, afterLen);
}

/**
 * Compute a StructuralChange for one scope. Generalization of
 * topLevelStructuralChange to arbitrary depth.
 */
function computeScopeDescriptor(
	ancestorPath: number[],
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	const D = ancestorPath.length;
	// Only count start/end that actually descend through this scope; scope
	// [2] isn't an ancestor of start=[0,1].
	const startDescends = pathHasPrefix(startPath, ancestorPath);
	const endDescends = pathHasPrefix(endPath, ancestorPath);
	const startIdx = startDescends && D < startPath.length ? startPath[D] : -1;
	const endIdx = endDescends && D < endPath.length ? endPath[D] : -1;

	let leftIdx = Number.MAX_SAFE_INTEGER;
	let rightIdx = -1;
	if (startIdx >= 0) {
		leftIdx = Math.min(leftIdx, startIdx);
		rightIdx = Math.max(rightIdx, startIdx);
	}
	if (endIdx >= 0) {
		leftIdx = Math.min(leftIdx, endIdx);
		rightIdx = Math.max(rightIdx, endIdx);
	}

	if (rightIdx < 0) return { op: 'noop' };

	const removed = beforeLen - afterLen;

	// Mixed-depth case: only one endpoint descends, but cascade-cleanup
	// removed siblings from the other side. Extend the touched range so the
	// descriptor reports the real splice and idMap[0]=0 preserves the
	// descending endpoint's id.
	if (removed > 0 && startDescends !== endDescends) {
		if (startDescends) {
			rightIdx = Math.max(rightIdx, startIdx + removed);
		} else {
			leftIdx = Math.min(leftIdx, Math.max(0, endIdx - removed));
		}
	}
	// Length-unchanged single-index edit: child modified in-place. Noop keeps
	// existing id/ref.
	if (removed === 0 && leftIdx === rightIdx) return { op: 'noop' };

	const count = rightIdx - leftIdx + 1;
	const newCount = Math.max(0, count - removed);

	const idMap: Record<number, number> = {};
	// Leftmost carries the start block's id (merged block or in-place-modified
	// ancestor of it).
	if (newCount > 0 && startIdx === leftIdx) {
		idMap[0] = 0;
	}
	// Rightmost carries the end container's id when end descends strictly
	// deeper (end's direct child here survives as in-place-modified).
	const endSurvives = endIdx >= 0 && endIdx === rightIdx && D + 1 < endPath.length;
	if (endSurvives && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: leftIdx, count, newCount, idMap };
}

/**
 * StructuralChange descriptor for the top-level children array after an
 * in-place rangeDelete.
 */
function topLevelStructuralChange(
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	const startTop = startPath[0];
	const endTop = endPath[0];
	const removed = beforeLen - afterLen;

	if (removed === 0) return { op: 'noop' };

	const count = endTop - startTop + 1;
	const newCount = count - removed;

	// Item at startTop always survives (merged block or in-place-modified
	// container); if end is nested, endTop also survives in-place.
	const endIsTopLevel = endPath.length === 1;
	const idMap: Record<number, number> = { 0: 0 };
	if (!endIsTopLevel && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: startTop, count, newCount, idMap };
}

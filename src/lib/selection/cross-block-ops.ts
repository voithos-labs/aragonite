/**
 * Cross-block mutation operations. Delete a cross-block selection range,
 * push undo, collapse, and restore the native caret in the merged block.
 *
 * Two classifications drive the commit path:
 *
 *   - Pure top-level (both endpoints at doc.children): route through
 *     `commitStructural`. The doc's blockIds/blockRefs are the only state
 *     that needs syncing — no nested container state is touched.
 *
 *   - Cross-container (at least one endpoint inside a container block):
 *     route through `commitMultiScope` with one scope per touched
 *     container. Every ancestor of start.path, every ancestor of end.path,
 *     and the LCA (plus doc scope if the LCA is the doc root) gets its
 *     BlockListState auto-synced by the primitive. This closes the
 *     latent desync in the former proxy-doc approach, where rangeDelete
 *     mutated live nested containers but only top-level ids/refs were
 *     republished — leaving `innerBlockIds.length !== node.children.length`
 *     and zombie keyed {#each} components.
 */

import type { SelectionState } from './selection-state.svelte';
import type { SelectionPoint } from './primitives';
import type { CstNode, Document } from '../core/nodes';
import type { MultiScopeTarget, UndoController } from '../components/editor-actions/deps';
import { applyCollapsedCaret } from './native-bridge';
import { rangeDelete } from './range-delete';
import type { StructuralChange } from '../tree-operations/structural-change';
import { nodeAt } from '../tree-operations/node-ops';
import { getStateForNode } from '../components/blocks/container-state/state-registry';

// ── Public API ─────────────────────────────────────────────────────────────

/** Everything a cross-block mutation needs from the calling block component. */
export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	controller: UndoController;
	/**
	 * Push an undo snapshot immediately, without the debounce. Used by the
	 * paste path to fold the cross-block delete and the paste splice into a
	 * single undo entry.
	 */
	pushUndoSnapshot: () => void;
	/** Trigger top-level reactivity. Used by the sync variant and legacy paths. */
	notifyDocMutated: () => void;
}

/**
 * Run rangeDelete on the current cross-block selection, commit via the
 * controller, collapse, and restore the native caret in the merged block.
 * Returns the collapsed caret position, or null if the selection wasn't
 * cross-block.
 *
 * `options.skipSnapshot` is for callers that have already pushed a snapshot
 * covering this delete (e.g., the cross-block paste path, which folds the
 * range-delete and the splice into a single undo entry).
 *
 * `options.skipCaretRestore` skips the post-tick caret restore — useful
 * when the caller plans to mutate the doc further after the delete and
 * will install a final caret itself.
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
 * Returns the collapsed caret position or null.
 *
 * Legacy commit path: pushes a snapshot + mutates the live doc via
 * rangeDelete + notifies reactivity. Intentionally NOT migrated to
 * commitMultiScope because compositionstart handlers cannot await (the IME
 * would swallow the composition if we yielded). The IME composition
 * bracket protects against observability of the intermediate desynced state
 * — the compositionend that follows re-renders the affected blocks from
 * the post-mutation CST, so any transient innerBlockIds/children mismatch
 * goes unobserved.
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
 * Pure top-level commit path: start and end paths both have length 1, so
 * rangeDelete never reaches into a nested container. The proxy-doc trick
 * is safe here because `nodeAt(proxyDoc, [i])` returns `topLevelChildren[i]`
 * (not a live nested node), and all splices land on the commit primitive's
 * children copy.
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
 * Cross-container commit path: run rangeDelete on the live doc inside a
 * commitMultiScope whose scope list covers every container whose children
 * array was spliced by the delete. For each scope we:
 *
 *   1. Snapshot `beforeLen` before rangeDelete mutates anything.
 *   2. Run rangeDelete once on the live doc (the single mutating call).
 *   3. Splice-in-place each scope's children copy to match the live
 *      post-mutation `node.children` — commitMultiScope's publish then
 *      assigns this copy back to `node.children` (idempotent) and runs
 *      the StructuralChange descriptor against `innerBlockIds`/`innerBlockRefs`.
 *
 * The descriptor per scope is derived from beforeLen/afterLen + the
 * start/end index ranges touched at that scope's depth. idMap preserves the
 * merged-block ID at the leftmost position, and (when end descends deeper
 * than the scope) preserves the end container's ID at the rightmost position.
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

	// Doc scope first when the LCA is doc-level (i.e., at least one endpoint
	// is in a different top-level child from the other, or one is top-level
	// and the other is nested). The doc scope lets commitMultiScope publish
	// doc.children / blockIds / blockRefs atomically with the container scopes.
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
			// Capture lengths by direct node-reference read BEFORE rangeDelete
			// mutates anything. Paths would become stale after the mutation
			// (e.g., a middle top-level block gets spliced out, shifting later
			// indices), but the node references stay valid — rangeDelete
			// splices node.children in place, never rebinding node identity.
			const beforeLens = scopes.map((s) => s.node.children?.length ?? 0);

			const result = rangeDelete(doc, start, end);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();

			// Sync each scope's children copy to the live post-mutation state.
			// scopeChildren[i].children is the same array reference that
			// commitMultiScope will publish back to node.children — splicing
			// its contents in place keeps that reference but makes it match
			// the live tree the rangeDelete mutations produced.
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
 * Enumerate every container whose children array gets spliced by a cross-
 * block delete. A container is "touched" if it lies on start.path strictly
 * above start, on end.path strictly above end, and has a registered
 * BlockListState (i.e., is currently mounted). The document root is NOT
 * included here — callers add it separately via `getDocScope()`.
 *
 * Returned in outermost-first order, de-duplicated when start and end share
 * ancestor containers.
 */
function collectTouchedContainers(
	doc: Document,
	startPath: number[],
	endPath: number[]
): Array<{ path: number[]; node: CstNode; state: ReturnType<typeof getStateForNode> & {} }> {
	const touched: Array<{
		path: number[];
		node: CstNode;
		state: ReturnType<typeof getStateForNode> & {};
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

	// Outermost-first: sort by path length then lexicographic.
	touched.sort((a, b) => {
		if (a.path.length !== b.path.length) return a.path.length - b.path.length;
		for (let i = 0; i < a.path.length; i++) {
			if (a.path[i] !== b.path[i]) return a.path[i] - b.path[i];
		}
		return 0;
	});
	return touched;
}

/** True iff `path` starts with `prefix` — i.e., `path` descends through the node at `prefix`. */
function pathHasPrefix(path: number[], prefix: number[]): boolean {
	if (prefix.length > path.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (path[i] !== prefix[i]) return false;
	}
	return true;
}

/**
 * Compute a StructuralChange for one scope given its ancestor path + the
 * before/after children-array lengths. Mirrors `topLevelStructuralChange`
 * but generalized to arbitrary depth.
 *
 * Range math: at scope depth D, startIdx = startPath[D], endIdx = endPath[D]
 * (when defined). The touched-index range is [leftIdx, rightIdx] spanning
 * whichever of start/end descends through this scope at this level.
 *
 * idMap preserves:
 *   - position 0 → old position 0 (the leftmost item survives as the merged
 *     block or as the in-place-modified container).
 *   - last new position → last old position, when end descends strictly
 *     deeper than this scope (meaning end's direct child at this level was
 *     modified in-place, not spliced out).
 */
function computeScopeDescriptor(
	ancestorPath: number[],
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	const D = ancestorPath.length;
	// Only count startPath/endPath contributions when they actually descend
	// through this scope. A scope at [2] isn't an ancestor of start=[0,1] —
	// startPath[2] is irrelevant there.
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

	// Mixed-depth case: only one endpoint descends through this scope, but
	// cascade-cleanup / range-walk removed siblings from the other direction.
	// Extend the touched range to cover those removals so the descriptor
	// reports the real splice, and idMap[0]=0 preserves the descending
	// endpoint's id instead of a deleted sibling's. See issues.md "mixed-
	// depth cross-scope delete".
	if (removed > 0 && startDescends !== endDescends) {
		if (startDescends) {
			// Items after startIdx were removed — extend right.
			rightIdx = Math.max(rightIdx, startIdx + removed);
		} else {
			// Items before endIdx were removed — extend left.
			leftIdx = Math.min(leftIdx, Math.max(0, endIdx - removed));
		}
	}
	// Length-unchanged single-index edit: the child at leftIdx was modified
	// in-place (replacement.length === 1, no cascade cleanup at this level).
	// Keep existing id/ref — returning noop leaves them untouched.
	if (removed === 0 && leftIdx === rightIdx) return { op: 'noop' };

	const count = rightIdx - leftIdx + 1;
	const newCount = Math.max(0, count - removed);

	const idMap: Record<number, number> = {};
	// Leftmost position always carries the start block's ID (start.path's
	// node at this level is either the merged block itself — when
	// leftIdx === startIdx — or an in-place-modified ancestor of it).
	if (newCount > 0 && startIdx === leftIdx) {
		idMap[0] = 0;
	}
	// Rightmost position carries the end container's ID when end descends
	// strictly deeper (end's direct child at this level survives as the
	// in-place-modified container, not a deleted leaf).
	const endSurvives = endIdx >= 0 && endIdx === rightIdx && D + 1 < endPath.length;
	if (endSurvives && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: leftIdx, count, newCount, idMap };
}

/**
 * Compute the StructuralChange descriptor for the top-level children array
 * after a rangeDelete. The array has already been mutated in-place.
 *
 * Cases:
 * - Both endpoints in the same top-level block: no top-level splice → noop
 * - Start is top-level (path.length===1): [startTop..endTop] replaced by
 *   merged result; surviving items inherit their old IDs via idMap
 * - Start is nested: [startTop+1..endTop] deleted; start block modified
 *   in-place; idMap preserves IDs for all surviving items
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

	// The item at startTop always survives (either as the merged block or as the
	// in-place-modified container). idMap[0] = 0 preserves its block ID.
	// If end is nested (endTop item modified in-place, not deleted), it also
	// survives as the last item in the new range — preserve its ID too.
	const endIsTopLevel = endPath.length === 1;
	const idMap: Record<number, number> = { 0: 0 };
	if (!endIsTopLevel && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: startTop, count, newCount, idMap };
}

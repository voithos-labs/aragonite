/**
 * Cross-block mutation operations. Delete a range, push undo, collapse, and
 * restore the native caret in the merged block.
 *
 * Commit paths:
 *   - Pure top-level (both endpoints at doc.children, neither a table unless
 *     the paths are equal) → commitStructural.
 *   - Cross-container (an endpoint nested, or a cross-path table endpoint —
 *     the whole-row snap splices table.children, so the table must commit as
 *     its own scope) → commitMultiScope with one scope per touched container,
 *     so every affected BlockListState stays in sync with node.children.
 *   - Intra-table full-table/row/column coverage (Backspace only) routes to
 *     range-delete-table-coverage; subset coverage falls through to the
 *     pure-top-level path's cell-clear primitive.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { SelectionState } from '../selection-state.svelte';
import type { GrammarView } from '../../schema/block-openers';
import type { SelectionPoint } from '../primitives';
import type { CstNode, Document } from '../../core/nodes';
import type { BlockComponent } from '../../block-component';
import type { CommitController, MultiScopeTarget } from '../../action-contracts';
import { focusCollapsedCaret } from '../native-bridge';
import { rangeDelete } from '../range-delete';
import type { StructuralChange } from '../../tree-operations/structural-change';
import { isBlockNode, nodeAt } from '../../tree-operations/node-ops';
import { pathHasPrefix, pathsEqual } from '../path-math';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import { getStateForNode } from '../../reactivity/state-registry';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import { maybeCommitTableCoverageDelete } from '../range-delete-table-coverage';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockMutationContext {
	selection: SelectionState;
	getDoc: () => Document;
	getBlockElByPath: (path: number[]) => HTMLElement | null;
	revealPath: (path: number[]) => Promise<BlockComponent | null>;
	controller: CommitController;
	/** Push an undo snapshot immediately, bypassing the debounce. */
	pushUndoSnapshot: () => void;
	/** The instance's block grammar, forwarded to the delete's ancestry rebuild so a
	 *  disabled kind's opener stays skipped when a range delete leaves marker syntax on
	 *  a container's opener line. Required-nullable like the dispatch context's twin, so
	 *  a new construction site can't silently skip the thread; `undefined` = global. */
	grammar: GrammarView | undefined;
}

/**
 * Options for {@link performCrossBlockDelete}. Absent = a plain destructive
 * delete with its own undo snapshot and caret restore.
 */
export interface CrossBlockDeleteOptions {
	/** `'join'`: the caller already pushed a snapshot covering this delete. */
	undoEntry?: UndoEntryMode;
	/** The caller installs a final caret after further mutations. */
	skipCaretRestore?: boolean;
	/**
	 * Route intra-table full-table/row/column coverage to a structural delete.
	 * Backspace opts in; type-replace/paste/cut stay on cell-clear so the
	 * follow-up insert lands in the anchor cell.
	 */
	tableCoverageDelete?: boolean;
}

/**
 * Run rangeDelete on the current cross-block selection, commit via the
 * controller, collapse, and restore the native caret. Returns the collapsed
 * caret position, or null if the selection wasn't cross-block. See
 * {@link CrossBlockDeleteOptions} for the option semantics.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: CrossBlockDeleteOptions
): Promise<SelectionPoint | null> {
	// Key auto-repeat, paste, or a composition can re-enter while a delete is
	// parked on its reveal await; both calls would resolve the SAME endpoints
	// and the second would delete against the mutated tree. Serialize per
	// selection: the follow-up waits out the in-flight commit, then re-resolves
	// — the collapsed selection makes it a no-op. When nothing is in flight
	// this adds no await, preserving the sync variant's no-yield window.
	let inFlight: Promise<SelectionPoint | null> | undefined;
	while ((inFlight = inFlightDeletes.get(ctx.selection))) {
		await inFlight.catch(() => {});
	}
	const run = runCrossBlockDelete(ctx, options);
	inFlightDeletes.set(ctx.selection, run);
	try {
		return await run;
	} finally {
		if (inFlightDeletes.get(ctx.selection) === run) inFlightDeletes.delete(ctx.selection);
	}
}

const inFlightDeletes = new WeakMap<SelectionState, Promise<SelectionPoint | null>>();

async function runCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: CrossBlockDeleteOptions
): Promise<SelectionPoint | null> {
	if (!ctx.selection.isCrossBlock) return null;
	const { start, end } = ctx.selection;
	if (!start || !end) return null;

	const doc = ctx.getDoc();
	// A cross-path table endpoint leaves the pure path: the whole-row snap
	// splices table.children, which only the multi-scope commit can sync to
	// the table's row state. Same-path (intra-table) deletes only clear cell
	// raws — no row splice — so they stay pure.
	const samePath = pathsEqual(start.path, end.path);
	const isPureTopLevel =
		start.path.length === 1 &&
		end.path.length === 1 &&
		(samePath || (!isTableAt(doc, start.path) && !isTableAt(doc, end.path)));

	const caretRestore = !options?.skipCaretRestore
		? (caret: SelectionPoint | null) => {
				if (caret) focusCollapsedCaret(ctx.getBlockElByPath, caret);
			}
		: undefined;

	// The collapse is start-wins: the merged block lands at start.path[0], which
	// the delete leaves in place (blocks above it don't move). Mount it now, while
	// caretRestore (running in the commit's non-awaited afterTick) still needs a
	// live element. Gated on caretRestore so the IME path (skipCaretRestore) never
	// yields before its synchronous commit — see performCrossBlockDeleteSync.
	if (caretRestore) {
		await ctx.revealPath(start.path);
	}

	if (options?.tableCoverageDelete && isPureTopLevel && samePath) {
		const block = nodeAt(doc, start.path);
		if (block && isBlockNode(block) && block.kind === 'table') {
			const handled = await maybeCommitTableCoverageDelete(
				ctx,
				block,
				start,
				end,
				options,
				caretRestore
			);
			if (handled) return handled.caret;
		}
	}

	if (isPureTopLevel) {
		return await commitPureTopLevelDelete(ctx, start, end, options, caretRestore);
	}
	return await commitCrossContainerDelete(ctx, doc, start, end, options, caretRestore);
}

/**
 * compositionstart variant — the IME swallows the composition if the handler
 * yields, so this must not await. The commit ceremony runs snapshot, mutate
 * (which collapses the selection), publish, and the edit event synchronously,
 * suspending only at its post-publish `await tick()` — so firing the async
 * path without awaiting keeps the whole delete inside the no-await window.
 * Caret restore stays skipped: the IME inserts at the browser's caret.
 */
export function performCrossBlockDeleteSync(ctx: CrossBlockMutationContext): void {
	void performCrossBlockDelete(ctx, { skipCaretRestore: true });
}

// ── Internal ───────────────────────────────────────────────────────────────

function isTableAt(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	return node !== null && isBlockNode(node) && node.kind === 'table';
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
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	let collapsedCaret: SelectionPoint | null = null;

	const snapshot =
		options?.undoEntry === 'join'
			? ('skip' as const)
			: { path: docPathFrom(start.path), offset: start.offset };

	await ctx.controller.commitStructural({
		snapshot,
		mutate: (topLevelChildren) => {
			// Honest literal: rangeDelete only walks children; prefix/suffix are inert here.
			const proxyDoc: Document = {
				kind: 'document',
				prefix: '',
				children: topLevelChildren,
				suffix: ''
			};
			const beforeLen = topLevelChildren.length;
			const result = rangeDelete(proxyDoc, start, end, ctx.controller.sharing, ctx.grammar);
			collapsedCaret = result.collapsedCaret;
			const afterLen = topLevelChildren.length;
			ctx.selection.collapse();
			return topLevelStructuralChange(start.path, end.path, beforeLen, afterLen);
		},
		op: { kind: 'delete', detail: { crossBlock: true }, eventPath: docPathFrom([start.path[0]]) },
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});

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
	options: Pick<CrossBlockDeleteOptions, 'undoEntry'> | undefined,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const touched = collectTouchedContainers(doc, start.path, end.path);
	const scopes: MultiScopeTarget[] = [];
	const containerPaths: number[][] = [];

	// A table endpoint addresses the table block itself (cell-index offset).
	// For ancestor-scope descriptors it behaves like a point one level deeper —
	// the table survives in place unless fully consumed, exactly like a
	// container an endpoint descends into — so deepen it before computing.
	const effStartPath = isTableAt(doc, start.path) ? [...start.path, 0] : start.path;
	const effEndPath = isTableAt(doc, end.path) ? [...end.path, 0] : end.path;

	// Doc scope goes first when the LCA is doc-level, so commitMultiScope
	// publishes doc.children / blockIds / blockRefs atomically with the
	// container scopes.
	const lcaIsDocRoot = start.path[0] !== end.path[0];
	if (lcaIsDocRoot) {
		scopes.push(ctx.controller.getDocScope());
		containerPaths.push([]);
	}

	for (const t of touched) {
		scopes.push({ node: t.node, state: t.state, path: t.path });
		containerPaths.push(t.path);
	}

	let collapsedCaret: SelectionPoint | null = null;

	await ctx.controller.commitMultiScope({
		scopes,
		// The selection start survives the delete (start-wins collapse), so its
		// deep path is a resolving restore coordinate.
		snapshot:
			options?.undoEntry === 'join'
				? 'skip'
				: { path: docPathFrom(start.path), offset: start.offset },
		mutate: (scopeViews) => {
			const sharing = scopeViews[0].sharing;
			// Read lengths BEFORE mutation. Paths go stale as rangeDelete
			// splices (middle top-level block shifts indices); the owned scope
			// views stay valid because splices happen in place — rangeDelete's
			// own spine unsharing reuses the already-owned scope nodes.
			const beforeLens = scopeViews.map((v) => v.children.length);

			const result = rangeDelete(doc, start, end, sharing, ctx.grammar);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();

			// An endpoint-table scope takes its descriptor from the row splice
			// the table branch actually performed — matched on the owned node
			// (prepareScopeView unshared the spine before rangeDelete ran, so
			// identities agree) — never from re-derived snap math.
			const rowSplices = result.tableRowSplices ?? [];
			return containerPaths.map((p, i): StructuralChange => {
				const rowSplice = rowSplices.find((s) => s.table === scopeViews[i].node);
				if (rowSplice) return { op: 'delete', at: rowSplice.at, count: rowSplice.count };
				return computeScopeDescriptor(
					p,
					effStartPath,
					effEndPath,
					beforeLens[i],
					scopeViews[i].children.length
				);
			});
		},
		op: { kind: 'delete', detail: { crossBlock: true }, eventPath: docPathFrom([start.path[0]]) },
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});

	return collapsedCaret;
}

/**
 * Enumerate every mounted container on start.path or end.path whose children
 * array gets spliced: strict ancestors of each endpoint, plus the endpoint
 * itself when it is a table (the whole-row snap splices table.children;
 * every other endpoint kind mutates raw only). Document root is excluded;
 * callers add it via `getDocScope()`. Returned outermost-first, de-duplicated
 * when start and end share ancestors.
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
		for (let depth = 1; depth <= leafPath.length; depth++) {
			const ancestorPath = leafPath.slice(0, depth);
			const node = nodeAt(doc, ancestorPath);
			if (!node || !isBlockNode(node) || !node.children) continue;
			if (depth === leafPath.length && node.kind !== 'table') continue;
			const key = ancestorPath.join('.');
			if (seen.has(key)) continue;
			seen.add(key);
			const state = getStateForNode(node);
			if (!state) continue;
			touched.push({ path: ancestorPath, node, state });
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
 * topLevelStructuralChange to arbitrary depth. Table endpoints must be
 * passed one level deeper than the table path (the cell dimension), so a
 * surviving table counts as a descended-into container.
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

	// No net removal in this scope: every slot in the window survived in
	// place (endpoint truncation/reparse happens in-slot). Noop keeps the
	// existing ids/refs — the pure top-level path's convention.
	if (removed === 0) return { op: 'noop' };

	// Mixed-depth case: only one endpoint descends, but cascade-cleanup
	// removed siblings from the other side. Extend the touched range so the
	// descriptor reports the real splice and idMap[0]=0 preserves the
	// descending endpoint's id.
	if (startDescends !== endDescends) {
		if (startDescends) {
			rightIdx = Math.max(rightIdx, startIdx + removed);
		} else {
			leftIdx = Math.min(leftIdx, Math.max(0, endIdx - removed));
		}
	}

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

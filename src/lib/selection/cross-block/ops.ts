/**
 * Cross-block mutation: delete a range, push undo, collapse, restore the caret. Commit
 * routing: pure top-level (both endpoints at doc.children, no cross-path table) commits
 * structurally; anything nested or with a cross-path table endpoint needs one scope per
 * spliced container, since the whole-row snap splices `table.children`. Intra-table
 * full-table/row/column coverage routes to `range-delete-table-coverage`.
 */

import type { UndoEntryMode } from '../../action-contracts';
import type { SelectionState } from '../selection-state.svelte';
import type { GrammarView } from '../../schema/block-openers';
import type { LinkReferenceResolverRef, PresentationModeGetter } from '../../editor-keys';
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
	/** Block grammar for the delete's ancestry rebuild. Required-nullable so a new construction
	 *  site can't silently skip the thread; `undefined` = global. */
	grammar: GrammarView | undefined;
	/** The effective mode the delete's join seam answers to (§ 4.5). Required-nullable for the
	 *  same reason as `grammar`; `undefined` reads as not-live, so the join stays byte-literal. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, so the seam parses the reference forms the render
	 *  path drew. Required-nullable beside the mode. */
	linkRef: LinkReferenceResolverRef | undefined;
}

/** Options for {@link performCrossBlockDelete}. Absent = plain delete, own snapshot and caret. */
export interface CrossBlockDeleteOptions {
	/** `'join'`: the caller already pushed a snapshot covering this delete. */
	undoEntry?: UndoEntryMode;
	/** The caller installs a final caret after further mutations. */
	skipCaretRestore?: boolean;
	/**
	 * Route intra-table full/row/column coverage to a structural delete. Backspace opts in;
	 * type-replace/paste/cut stay on cell-clear so the follow-up insert lands in the anchor cell.
	 */
	tableCoverageDelete?: boolean;
}

/**
 * rangeDelete the current cross-block selection, commit, collapse, restore the caret.
 * Returns the collapsed caret, or null when the selection wasn't cross-block.
 */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: CrossBlockDeleteOptions
): Promise<SelectionPoint | null> {
	// A re-entrant delete (auto-repeat, paste, composition) parked on the reveal await would
	// resolve the SAME endpoints and delete against the mutated tree. Serialize per selection;
	// with nothing in flight this adds no await, preserving the sync variant's no-yield window.
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
	// A cross-path table endpoint leaves the pure path: the whole-row snap splices
	// table.children, which only the multi-scope commit syncs. Intra-table clears only raws.
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

	// Start-wins collapse: the merged block lands at start.path[0] and stays put. Mount it now,
	// while caretRestore (a sync post-tick landing) still needs a live element. Gated on
	// caretRestore so the IME path never yields before its synchronous commit.
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
 * compositionstart variant: the IME swallows the composition if the handler yields, so this
 * must not await. The commit ceremony is synchronous up to its post-publish `await tick()`,
 * so firing without awaiting keeps the whole delete inside the no-await window.
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
 * Pure top-level commit path. Both paths have length 1, so rangeDelete never reaches into a
 * nested container and the proxy-doc (children copy) is a safe mutation target.
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
			const result = rangeDelete(
				proxyDoc,
				start,
				end,
				ctx.controller.sharing,
				ctx.grammar,
				ctx.getPresentationMode?.(),
				ctx.linkRef
			);
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
 * Cross-container commit path: one rangeDelete on the live doc inside a commitMultiScope
 * whose scope list covers every container whose children array was spliced.
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

	// A table endpoint addresses the table block itself (cell-index offset). For ancestor-scope
	// descriptors it behaves like a point one level deeper, so deepen it before computing.
	const effStartPath = isTableAt(doc, start.path) ? [...start.path, 0] : start.path;
	const effEndPath = isTableAt(doc, end.path) ? [...end.path, 0] : end.path;

	// Doc scope goes first when the LCA is doc-level, so commitMultiScope publishes
	// doc.children / blockIds / blockRefs atomically with the container scopes.
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
		// The selection start survives the delete (start-wins collapse), so its deep path is a
		// resolving restore coordinate.
		snapshot:
			options?.undoEntry === 'join'
				? 'skip'
				: { path: docPathFrom(start.path), offset: start.offset },
		mutate: (scopeViews) => {
			const sharing = scopeViews[0].sharing;
			// Read lengths BEFORE mutation: paths go stale as rangeDelete splices, while the owned
			// scope views stay valid because splices happen in place.
			const beforeLens = scopeViews.map((v) => v.children.length);

			const result = rangeDelete(
				doc,
				start,
				end,
				sharing,
				ctx.grammar,
				ctx.getPresentationMode?.(),
				ctx.linkRef
			);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();

			// An endpoint-table scope takes its descriptor from the row splice the table branch
			// actually performed, matched on the owned node, never from re-derived snap math.
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
 * Every mounted container on either endpoint path whose children array gets spliced: strict
 * ancestors, plus a table endpoint itself (the whole-row snap splices its children). Document
 * root excluded; callers add it via `getDocScope()`. Outermost-first, de-duplicated.
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
 * StructuralChange for one scope, at arbitrary depth. Table endpoints must arrive one level
 * deeper than the table path so a surviving table counts as a descended-into container.
 */
function computeScopeDescriptor(
	ancestorPath: number[],
	startPath: number[],
	endPath: number[],
	beforeLen: number,
	afterLen: number
): StructuralChange {
	const D = ancestorPath.length;
	// Only count start/end that actually descend through this scope: [2] isn't an ancestor of [0,1].
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

	// No net removal in this scope: every slot in the window survived in place, so noop keeps
	// the existing ids/refs (the pure top-level path's convention).
	if (removed === 0) return { op: 'noop' };

	// Mixed-depth: only one endpoint descends, but cascade-cleanup removed siblings from the
	// other side. Extend the window so the descriptor reports the real splice.
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
	// Leftmost carries the start block's id (merged, or an in-place-modified ancestor of it).
	if (newCount > 0 && startIdx === leftIdx) {
		idMap[0] = 0;
	}
	// Rightmost carries the end container's id when end descends strictly deeper.
	const endSurvives = endIdx >= 0 && endIdx === rightIdx && D + 1 < endPath.length;
	if (endSurvives && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: leftIdx, count, newCount, idMap };
}

/** StructuralChange for the top-level children array after an in-place rangeDelete. */
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

	// startTop always survives (merged, or in-place-modified); a nested end keeps endTop too.
	const endIsTopLevel = endPath.length === 1;
	const idMap: Record<number, number> = { 0: 0 };
	if (!endIsTopLevel && newCount > 1) {
		idMap[newCount - 1] = count - 1;
	}

	return { op: 'replace', at: startTop, count, newCount, idMap };
}

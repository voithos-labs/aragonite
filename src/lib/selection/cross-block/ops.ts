/**
 * Cross-block delete: one commit that deletes the range, collapses it and restores the caret.
 * A range between top-level blocks commits structurally; anything nested, or with an endpoint in
 * a table the other endpoint isn't in, needs one scope per spliced container.
 */

import type { SelectionState } from '../selection-state.svelte';
import type { Reading } from '../../schema/reading';
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import type { CstNode, Document } from '../../core/nodes';
import type { BlockComponent } from '../../block-component';
import type { CommitController, MultiScopeTarget } from '../../action-contracts';
import { focusCollapsedCaret } from '../native-bridge';
import { rangeDelete } from '../range-delete';
import { trackChildIds, type StructuralChange } from '../../tree-operations/structural-change';
import { documentBody, isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { pathsEqual } from '../path-math';
import { countsCells } from '../../schema/block-kind-descriptor';
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
	/** How the editor reads its bytes: the ancestor rebuild reads its grammar, and the join cleanup
	 *  its link definitions and mode (`docs/design/live-mode.md` § 4.5). */
	reading: Reading;
}

/** Options for {@link performCrossBlockDelete}. Absent = plain delete, own caret. */
export interface CrossBlockDeleteOptions {
	/** The caller installs a final caret after further mutations. */
	skipCaretRestore?: boolean;
	/** Delete a range covering a whole table, row or column structurally; without it the cells
	 *  are cleared and the table keeps its shape. */
	tableCoverageDelete?: boolean;
}

/**
 * Runs a cross-block gesture's writes as one undo entry holding the range as it stood; the range
 * start is where undo puts the caret back when nothing is focused.
 */
export function rangeUndoStep(
	ctx: CrossBlockMutationContext,
	run: () => Promise<unknown>
): Promise<void> {
	const start = ctx.selection.start;
	return ctx.controller.undoStep(deleteSnapshot(start?.path ?? [0], start?.offset ?? 0), run);
}

/** Returns the collapsed caret, or null when the selection wasn't cross-block. */
export async function performCrossBlockDelete(
	ctx: CrossBlockMutationContext,
	options?: CrossBlockDeleteOptions
): Promise<SelectionPoint | null> {
	// A re-entrant delete (key repeat, paste, composition) would resolve the same endpoints against
	// the mutated tree, so deletes queue per selection; with none queued this adds no await.
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
	// A table endpoint splices `table.children` (the whole-row snap), which only the multi-scope
	// commit syncs; a range inside one table clears only raws and stays top-level.
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

	// The start wins the collapse, so mount it now while `caretRestore` still needs a live element;
	// skipped without `caretRestore` so the IME path never yields before its synchronous commit.
	if (caretRestore) {
		await ctx.revealPath(start.path);
	}

	if (options?.tableCoverageDelete && isPureTopLevel && samePath) {
		const block = nodeAt(doc, start.path);
		if (block && isBlockNode(block) && countsCells(block)) {
			const handled = await maybeCommitTableCoverageDelete(ctx, block, start, end, caretRestore);
			if (handled) return handled.caret;
		}
	}

	if (isPureTopLevel) {
		return await commitPureTopLevelDelete(ctx, start, end, caretRestore);
	}
	return await commitCrossContainerDelete(ctx, doc, start, end, caretRestore);
}

/** For compositionstart, where the IME drops the composition if the handler yields: the commit
 *  is synchronous up to its `await tick()`, so firing without awaiting deletes before any yield. */
export function performCrossBlockDeleteSync(ctx: CrossBlockMutationContext): void {
	void performCrossBlockDelete(ctx, { skipCaretRestore: true });
}

// ── Internal ───────────────────────────────────────────────────────────────

function isTableAt(doc: Document, path: number[]): boolean {
	const node = nodeAt(doc, path);
	return node !== null && countsCells(node);
}

/** Both paths have length 1, so `rangeDelete` never reaches into a nested container and the
 *  top-level children copy is a safe mutation target. */
async function commitPureTopLevelDelete(
	ctx: CrossBlockMutationContext,
	start: SelectionPoint,
	end: SelectionPoint,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	let collapsedCaret: SelectionPoint | null = null;

	const snapshot = deleteSnapshot(start.path, start.offset);

	const doc = ctx.getDoc();
	await ctx.controller.commitStructural({
		snapshot,
		mutate: (topLevelChildren) => {
			const body = documentBody(doc, topLevelChildren);
			const ledger = trackChildIds(body);
			const result = rangeDelete(body, start, end, ctx.controller.sharing, ctx.reading);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();
			return ledger.read();
		},
		op: { kind: 'delete', detail: { crossBlock: true }, eventPath: docPathFrom([start.path[0]]) },
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});

	return collapsedCaret;
}

/** One `rangeDelete` on the live doc, with a commit scope for every container it splices. */
async function commitCrossContainerDelete(
	ctx: CrossBlockMutationContext,
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	caretRestore: ((caret: SelectionPoint | null) => void) | undefined
): Promise<SelectionPoint | null> {
	const touched = collectTouchedContainers(doc, start.path, end.path);
	const scopes: MultiScopeTarget[] = [];

	// The document scope goes first when the common ancestor is the root, so `commitMultiScope`
	// writes `doc.children`, the ids and the refs to state together with the container scopes.
	if (start.path[0] !== end.path[0]) {
		scopes.push(ctx.controller.getDocScope());
	}

	for (const t of touched) {
		scopes.push({ node: t.node, state: t.state, path: t.path });
	}

	let collapsedCaret: SelectionPoint | null = null;

	await ctx.controller.commitMultiScope({
		scopes,
		// The selection start survives the delete (the start wins the collapse), so its path still
		// resolves as the restore position.
		snapshot: deleteSnapshot(start.path, start.offset),
		mutate: (scopeViews) => {
			const sharing = scopeViews[0].sharing;
			// Opened before the mutation: paths go stale as `rangeDelete` splices, while the copied
			// scope nodes stay valid because splices happen in place.
			const ledgers = scopeViews.map((v) => trackChildIds(v.node));

			const result = rangeDelete(doc, start, end, sharing, ctx.reading);
			collapsedCaret = result.collapsedCaret;
			ctx.selection.collapse();

			// An endpoint table's scope reports the row splice the table branch actually made,
			// matched on the copied node, never a re-derived snap.
			const rowSplices = result.tableRowSplices ?? [];
			return ledgers.map((ledger, i): StructuralChange => {
				const rowSplice = rowSplices.find((s) => s.table === scopeViews[i].node);
				const change = rowSplice
					? ({ op: 'delete', at: rowSplice.at, count: rowSplice.count } as const)
					: ledger.read();
				ledger.release();
				return change;
			});
		},
		op: { kind: 'delete', detail: { crossBlock: true }, eventPath: docPathFrom([start.path[0]]) },
		afterTick: caretRestore ? () => caretRestore(collapsedCaret) : undefined
	});

	return collapsedCaret;
}

/** Every mounted container on either endpoint path whose children get spliced: strict ancestors,
 *  plus a table endpoint itself. The caller adds the document root with `getDocScope()`. */
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

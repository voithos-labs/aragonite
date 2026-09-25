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
import { deleteSnapshot, type SelectionPoint } from '../primitives';
import type { CstNode, Document } from '../../core/nodes';
import type { BlockComponent } from '../../block-component';
import type { CommitController, MultiScopeTarget } from '../../action-contracts';
import { focusCollapsedCaret } from '../native-bridge';
import { rangeDelete } from '../range-delete';
import { trackChildIds, type StructuralChange } from '../../tree-operations/structural-change';
import { isBlockNode, nodeAt } from '../../tree-operations/node-primitives';
import { pathsEqual } from '../path-math';
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
	/** Block grammar for the delete's ancestor rebuild. */
	grammar: GrammarView;
	/** The effective mode the delete's join cleanup reads (live-mode.md § 4.5). Nullable rather
	 *  than optional, so no caller skips it; `undefined` reads as not live and keeps every byte. */
	getPresentationMode: PresentationModeGetter | undefined;
	/** The instance's link-reference resolver, so the join cleanup parses the reference forms the
	 *  renderer drew. */
	linkRef: LinkReferenceResolverRef;
}

/** Options for {@link performCrossBlockDelete}. Absent = plain delete, own snapshot and caret. */
export interface CrossBlockDeleteOptions {
	/** `'join'`: the caller already pushed a snapshot covering this delete. */
	undoEntry?: UndoEntryMode;
	/** The caller installs a final caret after further mutations. */
	skipCaretRestore?: boolean;
	/** Delete a range covering a whole table, row or column structurally; without it the cells
	 *  are cleared and the table keeps its shape. */
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
	// A re-entrant delete (key auto-repeat, paste, composition) waiting on the mount would resolve
	// the same endpoints and delete against the mutated tree. Deletes are serialized per
	// selection; with none in progress this adds no await, so the sync variant still yields nowhere.
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
	// A table endpoint on a different path from the other leaves the top-level path: the
	// whole-row snap splices `table.children`, which only the multi-scope commit syncs. A range
	// inside one table clears only raws.
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

	// The start wins the collapse: the merged block lands at `start.path[0]` and stays put. Mount
	// it now, while `caretRestore` (a sync placement after the tick) still needs a live element.
	// Skipped without `caretRestore` so the IME path never yields before its synchronous commit.
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
 * The compositionstart variant: the IME swallows the composition if the handler yields, so this
 * must not await. The commit is synchronous up to its `await tick()` after the state write, so
 * firing without awaiting keeps the whole delete before any yield.
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

	const snapshot = deleteSnapshot(options, start.path, start.offset);

	const doc = ctx.getDoc();
	await ctx.controller.commitStructural({
		snapshot,
		mutate: (topLevelChildren) => {
			// The prefix stays inert; the suffix reads and writes through to the live document, so
			// the trailing-blank-line fix-up can write one.
			const proxyDoc: Document = {
				kind: 'document',
				prefix: '',
				children: topLevelChildren,
				get suffix() {
					return doc.suffix;
				},
				set suffix(value: string) {
					doc.suffix = value;
				}
			};
			const ledger = trackChildIds(proxyDoc);
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
			ctx.selection.collapse();
			return ledger.read();
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
		snapshot: deleteSnapshot(options, start.path, start.offset),
		mutate: (scopeViews) => {
			const sharing = scopeViews[0].sharing;
			// Opened before the mutation: paths go stale as `rangeDelete` splices, while the copied
			// scope nodes stay valid because splices happen in place.
			const ledgers = scopeViews.map((v) => trackChildIds(v.node));

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

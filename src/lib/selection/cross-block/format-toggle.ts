/**
 * The cross-block half of the inline format toggles: plan the per-block spans (`./format-range`),
 * write them all under one undo entry in a multi-scope commit, then put the range back over the
 * result through `restoreSelection`. The key dispatcher reaches this through an injected router,
 * so `schema/` keeps no import of selection code.
 */

import type { BlockComponent } from '../../block-component';
import type { CommitController } from '../../action-contracts';
import { ownTrailingLineEnding } from '../../core/lines';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import type { BlockElLookup, DocumentGetter } from '../../editor-keys';
import type { CrossBlockCommandRouter } from '../../schema/block-commands';
import { inlineMarkForCommand, type InlineMarkKind } from '../../schema/inline-construct-policy';
import type { Reading } from '../../schema/reading';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { comparePaths } from '../path-math';
import type { SelectionPoint } from '../primitives';
import { restoreSelection } from '../selection-restore';
import type { SelectionState } from '../selection-state.svelte';
import {
	applyCrossBlockFormat,
	crossBlockActiveFormats,
	planCrossBlockFormat,
	type CrossBlockFormatPlan
} from './format-range';

// ── Public API ─────────────────────────────────────────────────────────────

export interface CrossBlockCommandDeps {
	selection: SelectionState;
	getDoc: DocumentGetter;
	getBlockElByPath: BlockElLookup;
	revealPath: (path: number[]) => Promise<BlockComponent | null>;
	controller: CommitController;
	/** How the blocks were drawn: each span's toggle reads its link definitions and grammar, and
	 *  verifies its rewrite against its mode. */
	reading: Reading;
	/** The active-marks memo's key alongside the range: the document is mutated in place, so its
	 *  identity says nothing about whether it changed (`docs/design/editor.md` § 7). */
	getContentVersion: () => number;
}

export function createCrossBlockCommands(deps: CrossBlockCommandDeps): CrossBlockCommandRouter {
	const activeFormats = createActiveFormatMemo(deps);
	return {
		// Whether the command has a cross-block handler, not whether any block joins: that is only
		// known once the range is split into spans, and a keystroke that reaches no block writes
		// nothing.
		canRun: (id) => inlineMarkForCommand(id) !== null,
		run: (id) => {
			const mark = inlineMarkForCommand(id);
			if (!mark) return false;
			void toggleFormatOverRange(deps, mark.kind);
			return true;
		},
		isActive: (id) => {
			const mark = inlineMarkForCommand(id);
			return mark !== null && activeFormats().has(mark.kind);
		}
	};
}

// ── The active-marks memo ──────────────────────────────────────────────────

const NO_MARKS: ReadonlySet<InlineMarkKind> = new Set();

/** One entry rather than a cache: a toolbar asks once per button against one range, and the
 *  previous key is dead the moment the selection moves. Kept outside reactive state, like
 *  `inline-cache.ts`, since a derived read that wrote `$state` would be a write during a read. */
function createActiveFormatMemo(deps: CrossBlockCommandDeps): () => ReadonlySet<InlineMarkKind> {
	let slot: { key: string; marks: ReadonlySet<InlineMarkKind> } | null = null;
	return () => {
		const { start, end } = deps.selection;
		if (!start || !end) return NO_MARKS;
		const key = `${deps.getContentVersion()}|${pointKey(start)}|${pointKey(end)}`;
		if (slot?.key !== key) {
			slot = { key, marks: crossBlockActiveFormats(deps.getDoc(), start, end, deps.reading) };
		}
		return slot.marks;
	};
}

/** The offset's space is part of the identity: a cell point counts cells where a character
 *  point counts bytes, so the flag goes in the key. */
const pointKey = (point: SelectionPoint): string =>
	`${point.path.join(',')}@${point.offset}${point.cellCoordinate ? 'c' : ''}`;

// ── The commit ─────────────────────────────────────────────────────────────

async function toggleFormatOverRange(
	deps: CrossBlockCommandDeps,
	format: InlineMarkKind
): Promise<void> {
	const { anchor, focus, start, end } = deps.selection;
	if (!anchor || !focus || !start || !end) return;
	const doc = deps.getDoc();
	const plan = planCrossBlockFormat(doc, start, end, format, deps.reading);
	if (!plan) return;

	const restored = restoredRange(anchor, focus, start, end, plan);
	await deps.controller.commitMultiScope({
		// The document scope alone: the writes are bytes, not splices, so no container's children
		// array or id list moves and each touched chain rebuilds from its own leaf.
		scopes: [deps.controller.getDocScope()],
		// The endpoint's own space, like the plan's offsets: undo restores through the clamp that
		// reads a grid's path as cell indices.
		snapshot: { path: docPathFrom(start.path), offset: start.offset },
		mutate: ([docScope]) => {
			applyCrossBlockFormat(
				{ children: docScope.children },
				plan,
				docScope.sharing,
				docScope.lineEnding,
				deps.reading.grammar
			);
			return [{ op: 'noop' }];
		},
		op: {
			kind: 'updateContent',
			detail: { length: startBlockLength(doc, start, plan), crossBlock: true },
			eventPath: docPathFrom(start.path)
		},
		afterTick: async () => {
			await restoreSelection(restored, {
				getDoc: deps.getDoc,
				selectionState: deps.selection,
				getBlockElByPath: deps.getBlockElByPath,
				revealTarget: async (path) => (await deps.revealPath(path)) !== null
			});
		}
	});
}

/** The same pair, re-offset, with the user's anchor still on the side it was drawn from. */
function restoredRange(
	anchor: SelectionPoint,
	focus: SelectionPoint,
	start: SelectionPoint,
	end: SelectionPoint,
	plan: CrossBlockFormatPlan
): { anchor: SelectionPoint; focus: SelectionPoint } {
	const order = comparePaths(anchor.path, focus.path);
	const anchorLeads = order < 0 || (order === 0 && anchor.offset <= focus.offset);
	const first = withOffset(start, plan.startOffset);
	const last = withOffset(end, plan.endOffset);
	return anchorLeads ? { anchor: first, focus: last } : { anchor: last, focus: first };
}

const withOffset = (point: SelectionPoint, offset: number): SelectionPoint => ({
	...point,
	path: point.path.slice(),
	offset
});

/** The event detail's post-write length, read off the plan, since `op` is evaluated before
 *  `mutate` runs. A block the plan does not write reports its current length (`schema/operations.ts`). */
function startBlockLength(
	doc: ReturnType<DocumentGetter>,
	start: SelectionPoint,
	plan: CrossBlockFormatPlan
): number {
	const raw = blockNodeAt(doc, start.path)?.raw ?? '';
	const write = plan.writes.find((entry) => comparePaths(entry.path, start.path) === 0);
	return write ? write.newDisplay.length + ownTrailingLineEnding(raw).length : raw.length;
}

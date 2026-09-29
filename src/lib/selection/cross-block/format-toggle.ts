/**
 * The cross-block half of the inline format toggles: plan the per-block spans, write them under
 * one undo entry, and put the range back over the result. The key dispatcher reaches this module
 * through an injected router, so `schema/` keeps no import of selection code.
 */

import type { CommitController } from '../../action-contracts';
import { ownTrailingLineEnding } from '../../core/lines';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import type { DocumentGetter } from '../../editor-keys';
import type { CrossBlockCommandRouter } from '../../schema/block-commands';
import { inlineMarkForCommand, type InlineMarkKind } from '../../schema/inline-construct-policy';
import type { Reading } from '../../schema/reading';
import { blockNodeAt } from '../../tree-operations/node-primitives';
import { comparePaths } from '../path-math';
import { coverRange } from '../range-coverage';
import type { SelectionPoint } from '../primitives';
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
	controller: CommitController;
	/** How the blocks were drawn: each span's toggle reads its link definitions and grammar, and
	 *  verifies its rewrite against its mode. */
	reading: Reading;
	/** The active-marks memo's key alongside the range: the document is mutated in place, so its
	 *  identity says nothing about whether it changed. */
	getContentVersion: () => number;
}

export function createCrossBlockCommands(deps: CrossBlockCommandDeps): CrossBlockCommandRouter {
	const activeFormats = createActiveFormatMemo(deps);
	return {
		// Whether the command has a cross-block handler, not whether any block joins, which is known
		// only once the range splits into spans; a keystroke that reaches no block writes nothing.
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

/** One entry, not a cache: the previous key is dead once the selection moves. Outside reactive
 *  state, since a derived read that wrote `$state` would be a write during a read. */
function createActiveFormatMemo(deps: CrossBlockCommandDeps): () => ReadonlySet<InlineMarkKind> {
	let slot: { key: string; marks: ReadonlySet<InlineMarkKind> } | null = null;
	return () => {
		const { anchor, focus } = deps.selection;
		if (!anchor || !focus) return NO_MARKS;
		const key = `${deps.getContentVersion()}|${pointKey(anchor)}|${pointKey(focus)}`;
		if (slot?.key !== key) {
			const doc = deps.getDoc();
			const range = coverRange(doc, anchor, focus);
			slot = { key, marks: crossBlockActiveFormats(doc, range, deps.reading) };
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
	const { anchor, focus } = deps.selection;
	if (!anchor || !focus) return;
	const doc = deps.getDoc();
	const range = coverRange(doc, anchor, focus);
	const plan = planCrossBlockFormat(doc, range, format, deps.reading);
	if (!plan) return;
	const { start, end } = range;

	const restored = restoredRange(anchor, focus, start, end, plan);
	await deps.controller.commitMultiScope({
		// The document scope alone: the writes are bytes, not splices, so no container's children
		// array or id list moves and each touched chain rebuilds from its own leaf.
		scopes: [deps.controller.getDocScope()],
		// The endpoint's own space, like the plan's offsets: undo restores through the clamp that
		// reads a grid's path as cell indices.
		snapshot: { path: docPathFrom(start.path), offset: start.offset },
		mutate: ([docScope]) => {
			applyCrossBlockFormat(docScope.body, plan, docScope.sharing, deps.reading.grammar);
			return [{ op: 'noop' }];
		},
		op: {
			kind: 'updateContent',
			detail: { length: startBlockLength(doc, start, plan), crossBlock: true },
			eventPath: docPathFrom(start.path)
		},
		landing: () => restored
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
 *  `mutate` runs. A block the plan doesn't write reports its current length. */
function startBlockLength(
	doc: ReturnType<DocumentGetter>,
	start: SelectionPoint,
	plan: CrossBlockFormatPlan
): number {
	const raw = blockNodeAt(doc, start.path)?.raw ?? '';
	const write = plan.writes.find((entry) => comparePaths(entry.path, start.path) === 0);
	return write ? write.newDisplay.length + ownTrailingLineEnding(raw).length : raw.length;
}

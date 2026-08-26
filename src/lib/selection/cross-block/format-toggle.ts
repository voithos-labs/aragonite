/**
 * The cross-block arm of the inline format toggles: plan the per-block spans (`./format-range`),
 * write them all under ONE undo entry through the multi-scope ceremony, then put the range back
 * over the result through the shared restore road. The dispatch seam reaches this through an
 * injected router, so `schema/` keeps no edge to selection machinery.
 */

import type { BlockComponent } from '../../block-component';
import type { CommitController } from '../../action-contracts';
import { ownTrailingLineEnding } from '../../core/lines';
import { docPathFrom } from '../../cursor/coordinate-spaces';
import type { BlockElLookup, DocumentGetter, PresentationModeGetter } from '../../editor-keys';
import type { CrossBlockCommandRouter } from '../../schema/block-commands';
import type { GrammarView } from '../../schema/block-openers';
import { inlineMarkForCommand, type InlineMarkKind } from '../../schema/inline-construct-policy';
import { blockNodeAt } from '../../tree-operations/node-ops';
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
	/** The mode each per-block rewrite verifies against. Required-nullable like the cross-block
	 *  dispatch context's own threads; `undefined` reads as source. */
	getPresentationMode: PresentationModeGetter | undefined;
	grammar: GrammarView | undefined;
	/** The pressed-state memo's key alongside the range: the document is mutated in place, so its
	 *  identity witnesses nothing (`docs/design/editor.md` § 7). */
	getContentVersion: () => number;
}

export function createCrossBlockCommands(deps: CrossBlockCommandDeps): CrossBlockCommandRouter {
	const activeFormats = createActiveFormatMemo(deps);
	return {
		// Reachability of the arm, not participation: whether any block joins is only known once
		// the range is decomposed, and a press that reaches no block writes nothing.
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

// ── The pressed-state memo ─────────────────────────────────────────────────

const NO_MARKS: ReadonlySet<InlineMarkKind> = new Set();

/** One slot rather than a cache: a toolbar asks once per button against one range, and the previous
 *  key is dead the moment the selection moves. Outside reactive state like `inline-cache.ts`, since
 *  a derived read that wrote `$state` would be a write during a read. */
function createActiveFormatMemo(deps: CrossBlockCommandDeps): () => ReadonlySet<InlineMarkKind> {
	let slot: { key: string; marks: ReadonlySet<InlineMarkKind> } | null = null;
	return () => {
		const { start, end } = deps.selection;
		if (!start || !end) return NO_MARKS;
		const key = `${deps.getContentVersion()}|${pointKey(start)}|${pointKey(end)}`;
		if (slot?.key !== key) {
			slot = { key, marks: crossBlockActiveFormats(deps.getDoc(), start, end) };
		}
		return slot.marks;
	};
}

/** The offset's SPACE is part of the identity: a cell point counts cells where a char point
 *  counts bytes, so the flag rides the key. */
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
	const plan = planCrossBlockFormat(doc, start, end, format, deps.getPresentationMode?.());
	if (!plan) return;

	const restored = restoredRange(anchor, focus, start, end, plan);
	await deps.controller.commitMultiScope({
		// Doc scope alone: the writes are bytes, not splices, so no container's children array
		// or id list moves and each touched spine rebuilds from the leaf it owns.
		scopes: [deps.controller.getDocScope()],
		// The endpoint's own space, like the plan's offsets: undo restores through the clamp that
		// reads a grid's path as cell indices.
		snapshot: { path: docPathFrom(start.path), offset: start.offset },
		mutate: ([docScope]) => {
			applyCrossBlockFormat({ children: docScope.children }, plan, docScope.sharing, deps.grammar);
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

/**
 * The event detail's post-write length, read off the plan: `op` is spent before `mutate` runs.
 * A grid start endpoint names the grid, whose bytes the plan holds only as its cells' — the
 * rebuild re-pads every row, so it reports the length the grid stands at.
 */
function startBlockLength(
	doc: ReturnType<DocumentGetter>,
	start: SelectionPoint,
	plan: CrossBlockFormatPlan
): number {
	const raw = blockNodeAt(doc, start.path)?.raw ?? '';
	const write = plan.writes.find((entry) => comparePaths(entry.path, start.path) === 0);
	return write ? write.newDisplay.length + ownTrailingLineEnding(raw).length : raw.length;
}

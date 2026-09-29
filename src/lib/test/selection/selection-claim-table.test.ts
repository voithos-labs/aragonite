// @vitest-environment jsdom
// Every way the editor puts a selection down, over every editor-owned selection that could be live
// before it: afterwards only the written kind is live, and the selection read answers with it.
// Miss-analysis: each writer was tested against a live range only, so the gap caret's writer and
// the restore never met a selected widget, which they left selected.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import * as caretDoors from '../../selection/caret-doors';
import { placeCaret, placeGapCaret, selectWidgetWhole } from '../../selection/caret-doors';
import {
	applyCollapsedCaret,
	readCurrentSelection,
	readNativeCaretInBlock
} from '../../selection/native-bridge';
import type { EditorSelection } from '../../selection/primitives';
import { createSelectionState, type SelectionState } from '../../selection/selection-state.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import { restoreLandingOver } from '../harness/restore-landing';

const DOC = parse('zero\n\nabcdef\n\ntwo\n');
const at = (block: number, offset: number) => ({ path: [block], offset });
const caret = (block: number, offset: number): EditorSelection => ({
	anchor: at(block, offset),
	focus: at(block, offset)
});

type Kind = 'range' | 'gap' | 'widget' | 'none';

/** Block 1's element, attached so a caret placed in it is the browser's own. */
let blockEl: HTMLElement;

beforeEach(() => {
	blockEl = document.createElement('div');
	blockEl.contentEditable = 'true';
	blockEl.tabIndex = 0;
	blockEl.textContent = 'abcdef';
	document.body.append(blockEl);
	window.getSelection()?.removeAllRanges();
});

afterEach(() => blockEl.remove());

const PRIOR: Record<Exclude<Kind, 'none'>, (s: SelectionState) => void> = {
	range: (s) => s.enterCrossBlock(at(0, 1), at(2, 2)),
	gap: (s) => placeGapCaret(s, { parentPath: [], index: 1 }),
	widget: (s) => selectWidgetWhole(s, { paragraphPath: [0], sourceStart: 0, preSelectOffset: 0 })
};

interface Writer {
	name: string;
	write(s: SelectionState): void | Promise<unknown>;
	leaves: Kind;
	reads: EditorSelection | null;
}

const restore = (
	s: SelectionState,
	selection: Parameters<ReturnType<typeof restoreLandingOver>['landing']['restore']>[0]
) =>
	restoreLandingOver(DOC, s, {
		getBlockElByPath: (p) => (p[0] === 1 ? blockEl : null)
	}).landing.restore(selection);

const WRITERS: Writer[] = [
	{
		name: 'enterCrossBlock',
		write: (s) => s.enterCrossBlock(at(1, 1), at(2, 2)),
		leaves: 'range',
		reads: { anchor: at(1, 1), focus: at(2, 2) }
	},
	{
		name: 'placeGapCaret',
		write: (s) => placeGapCaret(s, { parentPath: [], index: 2 }),
		leaves: 'gap',
		reads: null
	},
	{
		name: 'selectWidgetWhole',
		write: (s) => selectWidgetWhole(s, { paragraphPath: [1], sourceStart: 2, preSelectOffset: 2 }),
		leaves: 'widget',
		reads: caret(1, 2)
	},
	{
		name: 'placeCaret',
		write: (s) =>
			placeCaret(s, (offset) => {
				blockEl.focus();
				applyCollapsedCaret(blockEl, at(1, offset));
			})(3),
		leaves: 'none',
		reads: caret(1, 3)
	},
	// jsdom moves the caret to a block's start when the block takes focus, so offset 0 reads back.
	{
		name: 'restore a caret',
		write: (s) => restore(s, caret(1, 0)),
		leaves: 'none',
		reads: caret(1, 0)
	},
	{
		name: 'restore a range',
		write: (s) => restore(s, { anchor: at(1, 1), focus: at(2, 2) }),
		leaves: 'range',
		reads: { anchor: at(1, 1), focus: at(2, 2) }
	},
	{
		name: 'restore a gap caret',
		write: (s) => restore(s, { gapCaret: { parentPath: [], index: 2 } }),
		leaves: 'gap',
		reads: null
	},
	{
		name: 'dropForDocumentSwap',
		write: (s) => s.dropForDocumentSwap(),
		leaves: 'none',
		reads: null
	}
];

function liveKinds(s: SelectionState): Kind[] {
	const kinds: Kind[] = [];
	if (s.isCrossBlock) kinds.push('range');
	if (s.gapCaret !== null) kinds.push('gap');
	if (s.widget !== null) kinds.push('widget');
	return kinds;
}

describe('one editor-owned selection at a time', () => {
	it('has a row for every export of the caret doors', () => {
		const rows = new Set(WRITERS.map((w) => w.name));
		expect(Object.keys(caretDoors).filter((name) => !rows.has(name))).toEqual([]);
	});

	for (const writer of WRITERS) {
		for (const prior of Object.keys(PRIOR) as (keyof typeof PRIOR)[]) {
			it(`${writer.name} over a live ${prior}`, async () => {
				const s = createSelectionState({ getDoc: () => DOC });
				PRIOR[prior](s);
				expect(liveKinds(s)).toEqual([prior]);

				await writer.write(s);

				expect(liveKinds(s)).toEqual(writer.leaves === 'none' ? [] : [writer.leaves]);
				const blockRefs = [
					undefined,
					stubBlockComponent({
						getCursorOffset: () => readNativeCaretInBlock(blockEl, [1])?.offset ?? null
					})
				];
				expect(readCurrentSelection(s, blockRefs)).toEqual(writer.reads);
			});
		}
	}
});

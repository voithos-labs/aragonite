/**
 * The `beforeinput` steps for typed text that a prose block and a table cell share: the delimiter
 * auto-pair first, since the live range edit writes a delimiter at a collapsed caret as a lone byte,
 * then the range edit, then text typed against a widget that ends the block. The two blocks differ
 * only in how they read their own text.
 */

import type { NodeView } from '../../../core/node-views';
import type { ContentRange } from '../../../core/inline';
import type { StoredAs } from '../../../schema/stored-as';
import type { Reading } from '../../../schema/reading';
import type { CaretMemory } from '../../../caret/caret-memory';
import { asRawOffset } from '../../../caret/coordinate-spaces';
import { keepsKindAt } from '../../../core/inline/live-edit/read-back';
import type { SurfaceBackend } from '../editable/surface-backend';
import { rangeWrite, type TextWrite } from '../editable/surface-write';
import type { BlockAutoPairs } from './auto-pair-record';
import { applyDelimiterAutoPair } from './delimiter-autopair';
import type { TypedPlacement } from './edge-seat';
import { applyLiveRangeEdit } from './live-selection-edit';
import type { WidgetInteraction } from './widget-interaction';
import type { EdgePolicyDispatch } from './edge-policy-dispatch';

export interface TypedInputDeps {
	get node(): NodeView;
	cursor: SurfaceBackend;
	storedAs: () => StoredAs;
	widgets: Pick<WidgetInteraction, 'isRevealing' | 'foldRevealBeforeMutation'>;
	placement: TypedPlacement;
	caretMemory: Pick<CaretMemory, 'noteOutside'>;
	/** Whether a marker run the screen paints nothing for touches `caret` (`edge-step.ts`). */
	hiddenRunAt: (caret: number) => boolean;
	reading: Reading;
	ownPairs: BlockAutoPairs;
	writeText: (write: TextWrite) => unknown;
	/** The block's caret-edge dispatch, which writes a key the browser drops beside a widget. */
	edges: Pick<EdgePolicyDispatch, 'typeBeforeClosingWidget'>;
	/** The bytes the caret counts into. */
	text: () => string;
	/** The part of `text` that is the block's content, past any marker of its own. */
	content: () => ContentRange;
	/** Whether a step-over leaves a line an on-type completer takes (`$$`); omitted where no
	 *  completer runs, as in a table cell. */
	completesLine?: (caret: number) => boolean;
}

/** The block's typed-input step: true when the auto-pair or the range edit took the event. */
export function createTypedInput(deps: TypedInputDeps): (e: InputEvent) => boolean {
	// A range edit in a mode that draws no delimiter goes through the join rules, since the browser
	// would leave the crossed markers behind. Elsewhere the browser keeps its own edit.
	const rangeEdit = (e: InputEvent): boolean =>
		applyLiveRangeEdit(
			e,
			deps.node,
			deps.cursor,
			deps.storedAs(),
			deps.widgets.isRevealing,
			(edit) =>
				void deps.writeText({
					...rangeWrite(deps.node, edit),
					intent: 'typed',
					history: 'join-typing',
					mode: 'authored',
					source: 'live-selection-edit'
				})
		);

	// The write takes the same path as the range edit, so the block repaints once with the caret
	// inside the pair.
	const autoPair = (e: InputEvent): boolean =>
		applyDelimiterAutoPair(e, {
			text: deps.text,
			content: deps.content,
			caret: () => deps.cursor.getRaw(),
			placeTyped: deps.placement.offsetFor,
			hasSelection: () => deps.cursor.getRawSelection() !== null,
			isRevealing: deps.widgets.isRevealing,
			foldReveal: () => deps.widgets.foldRevealBeforeMutation(),
			setCaret: (offset) => deps.cursor.setRaw(asRawOffset(offset), { clamp: 'exact' }),
			seatOutside: deps.caretMemory.noteOutside,
			passCloser: deps.placement.passCloser,
			hiddenRunAt: deps.hiddenRunAt,
			completesLine: deps.completesLine,
			keepsKind: (line) => keepsKindAt(deps.node, line, deps.storedAs()),
			reading: deps.reading,
			ownPairs: deps.ownPairs,
			write: (text, caretAfter) =>
				void deps.writeText({
					text,
					caretAfter,
					intent: 'typed',
					history: 'join-typing',
					mode: 'authored',
					source: 'delimiter-autopair',
					inPlace: true
				})
		});

	// Firefox drops a native insertion right before an inline widget that ends the block.
	const beforeClosingWidget = (e: InputEvent): boolean => {
		if (e.inputType !== 'insertText' || e.isComposing || !e.data) return false;
		const caret = deps.cursor.getRaw();
		if (caret === null || !deps.edges.typeBeforeClosingWidget(caret, e.data)) return false;
		e.preventDefault();
		return true;
	};

	return (e) => autoPair(e) || rangeEdit(e) || beforeClosingWidget(e);
}

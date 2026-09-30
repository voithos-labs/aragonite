/**
 * The one write a block's editable element makes to its own text: the text block, a table cell,
 * the code block and an editable leaf. The caller hands over the new displayed text and where the
 * caret goes; the write picks the undo caret, adds the block's line ending and puts the caret back.
 */

import type { BlockEditActions, ContentWrite } from '../../action-contracts';
import type { NodeView } from '../../core/node-views';
import type { WriteMode } from '../../schema/block-kind-descriptor';
import type { Reading } from '../../schema/reading';
import type { LeafRangeEdit } from '../../tree-operations/leaf-range';
import type { KindCue } from '../kind-cue.svelte';
import type { BlockAutoPairs } from './text/auto-pair-record';
import { shownKind } from '../../core/parsers/heading';
import { ownTrailingLineEnding, trimTrailingLineEnding, type LineEnding } from '../../core/lines';
import { planTypedCompletion } from '../../editor-actions/enter-completion';
import { withStoredCaret } from '../../editor-actions/stored-caret';

/** `typed` is a keystroke's own edit, which can name a new block kind and complete its line;
 *  `repair` is the editor's own fix-up, with no key behind it. */
export type WriteIntent = 'typed' | 'repair';

export interface TextWrite {
	/** The block's displayed text after the edit, without its trailing line ending. */
	text: string;
	/** Where the caret goes, counted in `text`. */
	caretAfter: number;
	intent: WriteIntent;
	mode: WriteMode;
	/** The gesture, for the interaction trace. */
	source: string;
	/** Undo's caret for a key over a selected widget, where the browser holds no caret; every
	 *  other write takes the caret recorded when the input began. */
	sessionAnchor?: number;
	/** Leave the caret alone: a widget's own key edits it and keeps it selected. */
	leavesCaret?: true;
}

export interface SurfaceWriteDeps {
	getNode(): NodeView;
	getIndex(): number;
	getPath(): number[];
	blockEdit: BlockEditActions;
	kindCue: KindCue;
	reading: Reading;
	/** The ending a new line takes here: the block's own, else the document's. */
	lineEnding(): LineEnding;
	getPreEditOffset(): number;
	/** Puts the caret at `at` once the write's render lands, while the block still has focus. */
	requestCaret(at: number, opts: { source: string }): void;
	/** A prose block's view of the pair the auto-pair wrote, which every write keeps in step. */
	ownPairs?: BlockAutoPairs;
}

export function createSurfaceWrite(deps: SurfaceWriteDeps): (write: TextWrite) => ContentWrite {
	return function writeText(write) {
		const node = deps.getNode();
		const index = deps.getIndex();
		const typed = write.intent === 'typed';
		const before = shownKind(node);
		const written = deps.blockEdit.updateBlockContent(
			index,
			// The block's own ending only: a last line saved without one stays that way.
			write.text + ownTrailingLineEnding(node.raw),
			write.mode,
			write.sessionAnchor ?? deps.getPreEditOffset(),
			write.caretAfter
		);
		if (!written.admitted) return written;
		// Ends the record once the pair it wrote no longer stands in the new bytes.
		deps.ownPairs?.consult(write.text, write.caretAfter);
		if (!write.leavesCaret) deps.requestCaret(written.caret, { source: write.source });
		if (!typed) return written;
		// An in-place write has already landed, so whether a completer takes the line is known now.
		const completes =
			written.keepsCaret &&
			planTypedCompletion(
				deps.getNode(),
				written.caret,
				deps.reading.grammar,
				deps.lineEnding()
			) !== null;
		const landed = written.then(
			async (wrote) => (await deps.blockEdit.completeLineOnType(index, written.caret)) || wrote
		);
		void deps.kindCue.afterTypedWrite(landed, deps.getPath(), before);
		return withStoredCaret(
			landed,
			written.caret,
			written.storedOffset,
			written.keepsCaret && !completes
		);
	};
}

/** A range edit as the text a surface write takes: its bytes, less the ending the write adds. */
export function rangeWrite(
	edit: Pick<LeafRangeEdit, 'raw' | 'caret'>
): Pick<TextWrite, 'text' | 'caretAfter'> {
	return { text: trimTrailingLineEnding(edit.raw), caretAfter: edit.caret };
}

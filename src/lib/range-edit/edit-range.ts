/**
 * A gesture over a range of a Markdown document, answered in bytes: copy, cut, Backspace or Delete,
 * the removal a typed key, a composition or a command makes first, a paste, a drop. It reads the
 * document through `host` and returns the new bytes, where the caret lands and what a copy or a cut
 * puts on the clipboard; the editor applies the answer. The laws it keeps are `test/range-edit/laws.ts`.
 */

import type { SpliceCaret } from '../action-contracts';
import { isBlankText } from '../core/lines';
import type { Mode, RangeHost } from './host';
import { copyOf } from './copy';
import { contentEnd, factsOf, readDoc, type Doc } from './document';
import type { Edit } from './leaf-splice';
import { ownEntry, restored } from './own-entry';
import { pasteAt } from './paste';
import { removeRange } from './removal';

/** Two byte offsets, `from <= to`, after the editor widened the range to every block it takes
 *  whole; a caret is a range with `from === to`. */
export interface Range {
	from: number;
	to: number;
}

export type Gesture =
	| 'copy'
	| 'cut'
	| 'backspace'
	| 'delete'
	/** The removal a typed character, a composition or a command key makes first. */
	| 'type'
	| 'compose'
	| 'command'
	/** Clipboard text with LF line endings, and the editor's own entry an earlier copy or cut
	 *  wrote, while the clipboard still holds it. */
	| { paste: string; plain: boolean; own?: string }
	/** The range dragged and dropped at byte `drop`: moved, or copied. */
	| { drop: number; copy: boolean };

export interface RangeEditResult {
	source: string;
	caret: SpliceCaret;
	/** What a copy or a cut writes to the clipboard. */
	clipboard?: string;
	/** The editor's own clipboard entry a copy or a cut writes beside it. */
	own?: string;
}

export function editRange(
	source: string,
	range: Range,
	gesture: Gesture,
	mode: Mode,
	host: RangeHost
): RangeEditResult {
	const doc = readDoc(source, host, mode);
	const { from, to } = range;
	const read = (edit: Edit) => readDoc(edit.source, host, mode);
	const answer = (edit: Edit): RangeEditResult => ({
		source: edit.source,
		caret: caretOf(edit, read(edit))
	});
	// Text typed or pasted over one block held whole takes its place, and the line stays.
	const inPlace = { source: source.slice(0, from) + source.slice(to), caret: from };
	const replaced = heldAlone(doc, from, to);
	// A range a cut takes nothing from (a hidden fence, a title row's line ending, markers alone)
	// copies only blank lines, so pasting it back changes no block.
	const copied = (cut: { source: string }) => {
		const copy = copyOf(doc, from, to);
		return cut.source !== source || isBlankText(copy) ? copy : '';
	};
	if (gesture === 'copy' || gesture === 'cut') {
		const cut = answer(removeRange(doc, from, to));
		const clipboard = copied(cut);
		const own = ownEntry(source, from, to, { source: cut.source, caret: cut.caret.at });
		if (gesture === 'cut') return { ...cut, clipboard, own };
		return { source, caret: { at: to, holds: 'text' }, clipboard, own };
	}
	if (typeof gesture === 'string')
		return answer(gesture === 'type' && replaced ? inPlace : removeRange(doc, from, to));
	if ('paste' in gesture) {
		const own = gesture.plain ? undefined : gesture.own;
		const back = own === undefined ? null : restored(source, from, to, own);
		if (back) return answer(back);
		if (from === to) return answer(pasteAt(doc, from, gesture.paste, gesture.plain));
		// The paste lands where the removal's caret does, as a cut's then a paste's would.
		const removed = replaced ? inPlace : removeRange(doc, from, to);
		const after = read(removed);
		return answer(pasteAt(after, caretOf(removed, after).at, gesture.paste, gesture.plain));
	}
	const removed = removeRange(doc, from, to);
	const clipboard = copied(removed);
	if (gesture.copy) return answer(pasteAt(doc, gesture.drop, clipboard, false));
	// A moving drop is a cut, then a paste of its text and own entry at the drop point.
	const after = read(removed);
	const own = ownEntry(source, from, to, { ...removed, caret: caretOf(removed, after).at });
	const at =
		gesture.drop <= from ? gesture.drop : gesture.drop - (source.length - removed.source.length);
	return answer(restored(removed.source, at, at, own) ?? pasteAt(after, at, clipboard, false));
}

/** The range is exactly one block other than a paragraph, from its first byte to the end of its
 *  last line. */
function heldAlone(doc: Doc, from: number, to: number): boolean {
	return doc.layout.blocks.some(
		(b) =>
			b.from === from && contentEnd(doc, b) === to && from < to && factsOf(doc, b).joins !== 'text'
	);
}

/** The caret named by what the new bytes hold there: text, or failing that the text just before it
 *  on its line, or the start of a block, or the boundary between two. */
function caretOf(edit: Edit, result: Doc): SpliceCaret {
	let at = edit.caret;
	const lineStart = edit.source.lastIndexOf('\n', at - 1) + 1;
	while (at > lineStart && !result.layout.pointAt(at)) at--;
	if (edit.source === '' || result.layout.pointAt(at)) return { at, holds: 'text' };
	const block = result.layout.blocks.some((b) => b.from === edit.caret);
	return { at: edit.caret, holds: block ? 'block' : 'boundary' };
}

/**
 * Where a collapsed typed insert is decided for every editable leaf: where the browser's own insert
 * can miss the editor's caret (beside a widget, a target the engine aimed away from the caret, a
 * widget selected whole), its default is prevented and the block writes the text at the caret. A
 * caret in a text node keeps the browser's insert, read back on `input` (`docs/design/editor.md`).
 */

import { imeOwnsInput } from '../../../browser/composition';
import { readInput, targetRange } from '../../../browser/input';
import type { DomPosition } from '../../../browser/offsets';
import { widgetFollowsText } from '../../../browser/painted';
import { isPlainTypingKey } from '../text/click-snap-guard';

/** What a block that draws inline widgets writes for a typed insert it takes. */
export interface TypedInsertWrites {
	/** Writes `text` over the widget selected whole in the block; false when none is. */
	typeOverSelected(text: string): boolean;
	/** Whether a widget or a decoration starts or ends at raw `caret`. */
	widgetBeside(caret: number): boolean;
	/** Whether a widget starting at raw `caret` ends the block's content. */
	widgetClosesAt(caret: number): boolean;
	/** Writes `text` at raw `caret`, as a typed byte, placed like any other insertion. */
	typeAt(caret: number, text: string): void;
}

export interface TypedInsertReads {
	composing(): boolean;
	/** The block's element, which the caret must be inside. */
	el(): HTMLElement | null;
	/** The live caret's DOM position in the block, null for a range or a caret elsewhere. */
	caretPosition(): DomPosition | null;
	/** The caret's raw offset, read only once the browser's insert is in doubt. */
	caret(): number | null;
	/** Where a range the browser names starts, as a raw offset in the block. */
	rawStartOf(range: AbstractRange): number | null;
	/** Whether the caret sits on a line Shift+Enter opened, whose own write spends the insertion. */
	onOpenLine(): boolean;
	/** Absent where the block draws no inline widgets. */
	writes?: TypedInsertWrites;
}

export type TypedDecline =
	'composing' | 'not-cancelable' | 'no-text' | 'no-caret' | 'open-line' | 'surface' | 'at-caret';

export type TypedVerdict = { decided: true } | { decided: false; decline: TypedDecline };

/** The verdict on a `beforeinput` that inserts typed text; null for every other input. */
export function decideTypedInsert(e: InputEvent, reads: TypedInsertReads): TypedVerdict | null {
	if (readInput(e).kind !== 'insert') return null;
	if (imeOwnsInput(e) || reads.composing()) return declined('composing');
	if (!e.cancelable) return declined('not-cancelable');
	const text = e.data;
	if (!text) return declined('no-text');
	const decline = typeAtCaret(text, reads, e);
	if (decline) return declined(decline);
	e.preventDefault();
	return { decided: true };
}

/** The same decision at a typed key's keydown, for an engine that sends no `beforeinput` beside a
 *  widget with no text node to type into (every engine measured sends one). True when taken. */
export function decideTypedKey(e: KeyboardEvent, reads: TypedInsertReads): boolean {
	if (e.defaultPrevented || !isPlainTypingKey(e) || reads.composing()) return false;
	if (typeAtCaret(e.key, reads, null)) return false;
	e.preventDefault();
	return true;
}

/** Writes `text` at the editor's caret where the browser's insert could miss it, else says why it
 *  left the insert to the browser. A keydown (`e` null) decides only the caret beside a widget. */
function typeAtCaret(
	text: string,
	reads: TypedInsertReads,
	e: InputEvent | null
): TypedDecline | null {
	const writes = reads.writes;
	if (!writes) return 'surface';
	if (writes.typeOverSelected(text)) return null;
	if (reads.onOpenLine()) return 'open-line';
	const at = reads.caretPosition();
	const el = reads.el();
	if (!at || !el) return 'no-caret';
	const write = (caret: number): null => {
		writes.typeAt(caret, text);
		return null;
	};
	if (at.node.nodeType !== Node.TEXT_NODE) {
		const caret = reads.caret();
		if (caret !== null && writes.widgetBeside(caret)) return write(caret);
	} else if (
		e &&
		at.offset === (at.node as Text).length &&
		widgetFollowsText(el, at.node as Text)
	) {
		const caret = reads.caret();
		if (caret !== null && writes.widgetClosesAt(caret)) return write(caret);
	}
	if (!e) return 'at-caret';
	const target = targetRange(e);
	if (!target?.collapsed) return 'at-caret';
	if (target.startContainer === at.node && target.startOffset === at.offset) return 'at-caret';
	const aimed = reads.rawStartOf(target);
	const caret = reads.caret();
	return aimed === null || caret === null || aimed === caret ? 'at-caret' : write(caret);
}

function declined(decline: TypedDecline): TypedVerdict {
	return { decided: false, decline };
}

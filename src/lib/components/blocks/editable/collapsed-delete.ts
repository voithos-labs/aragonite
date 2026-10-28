/**
 * Where a collapsed delete is decided for every editable leaf: the browser's delete is prevented
 * and the block writes the bytes (`caret/delete-extent.ts`), so all engines take the same text. A
 * delete it declines goes on to the browser and is read back on `input`. A chord's answer that no
 * unit changes is decided at its keydown, since an engine may send no input for it.
 */

import { imeOwnsInput } from '../../../browser/composition';
import {
	characterExtent,
	type DeleteAnswer,
	type DeleteDecline,
	type DeleteVerdict
} from '../../../caret/delete-extent';
import { decidedDelete, type DeleteDirection, type DeleteIntent } from '../../../browser/input';
import type { RawRange } from '../../../browser/offsets';
import { isBareKey } from '../text/click-snap-guard';

export interface CollapsedDeleteReads {
	composing(): boolean;
	caret(): number | null;
	hasRange(): boolean;
	/** The text the caret counts into, as the block shows it now. */
	text(): string;
	/** The raw range the browser reports the input would take, null where it names none. */
	targetRange(e: InputEvent): RawRange | null;
	deleteAtCaret?: (caret: number, intent: DeleteIntent) => DeleteAnswer;
	/** Takes or enters what a delete of any unit facing `direction` meets at `caret`; true when it
	 *  did. Absent where the block draws no widgets. */
	deleteBeside?: (caret: number, direction: DeleteDirection) => boolean;
	/** Whether `caret` is the first or last offset the caret can reach, on the side `direction` faces. */
	atEdge(caret: number, direction: DeleteDirection): boolean;
	/** Runs what the plain key binds at this block, through the editor's keymap and the host's
	 *  `keybindings`; absent where the block binds nothing. */
	runPlainKey?: (key: PlainDeleteKey) => void;
}

export type PlainDeleteKey = 'Backspace' | 'Delete';

/** What a Backspace or Delete chord the keymap left alone does at its keydown: takes what it faces
 *  beside the caret, else runs the plain key at the edge it faces. Null leaves it to its input. */
export function decideDeleteChord(
	e: KeyboardEvent,
	reads: CollapsedDeleteReads
): 'beside' | 'at-edge' | null {
	const key = e.key;
	if (key !== 'Backspace' && key !== 'Delete') return null;
	if (isBareKey(e) || e.defaultPrevented || reads.hasRange()) return null;
	const caret = reads.caret();
	if (caret === null) return null;
	const direction = key === 'Backspace' ? 'backward' : 'forward';
	if (reads.deleteBeside?.(caret, direction)) {
		e.preventDefault();
		return 'beside';
	}
	if (!reads.atEdge(caret, direction)) return null;
	// Prevented whatever the binding does: the browser's own delete there takes a hidden marker.
	e.preventDefault();
	reads.runPlainKey?.(key);
	return 'at-edge';
}

/** The verdict on a `beforeinput` the editor decides deletes for; null for every other input.
 *  `keyChord` is the opening Backspace or Delete keydown's chord, null for a soft keyboard. */
export function decideCollapsedDelete(
	e: InputEvent,
	keyChord: string | null,
	reads: CollapsedDeleteReads
): DeleteVerdict | null {
	const intent = decidedDelete(e);

	if (!intent) return null;
	const caret = reads.caret();
	const decline = declineReason(e, intent, caret, keyChord !== null, reads);
	if (decline || caret === null) return { decided: false, decline: decline ?? 'no-caret' };
	const answer = reads.deleteAtCaret?.(caret, intent) ?? 'declined';
	if (answer === 'declined') return { decided: false, decline: 'surface' };
	// The browser's own delete at the edge can take a hidden marker, so it never runs.
	e.preventDefault();
	// Every unit at the edge does what the plain key does; that key's own binding ran at its keydown.
	const plain: PlainDeleteKey = intent.direction === 'backward' ? 'Backspace' : 'Delete';
	if (answer === 'at-edge' && keyChord !== plain) reads.runPlainKey?.(plain);
	return { decided: true };
}

function declineReason(
	e: InputEvent,
	intent: DeleteIntent,
	caret: number | null,
	keyed: boolean,
	reads: CollapsedDeleteReads
): DeleteDecline | null {
	if (imeOwnsInput(e) || reads.composing()) return 'composing';
	if (!e.cancelable) return 'not-cancelable';
	if (reads.hasRange()) return 'range';
	if (caret === null) return 'no-caret';
	// A word or line names its own reach; only a one-character delete can be an autocorrect's.
	const character = intent.unit === 'character';
	if (!keyed && character && widerThanCharacter(e, intent.direction, caret, reads)) {
		return 'wide-keyless';
	}
	return null;
}

/** A soft keyboard's delete that names more than one character (an autocorrected word) is the
 *  keyboard's own edit, which the browser keeps. */
function widerThanCharacter(
	e: InputEvent,
	direction: DeleteDirection,
	caret: number,
	reads: CollapsedDeleteReads
): boolean {
	const target = reads.targetRange(e);
	if (!target) return false;
	const text = reads.text();
	const unit = characterExtent(text, caret, direction, { start: 0, end: text.length });
	return target.end - target.start > (unit ? unit.end - unit.start : 0);
}

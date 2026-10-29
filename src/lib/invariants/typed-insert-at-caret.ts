/**
 * G1.161: a collapsed typed insert the editor left to the browser lands at the caret it started at,
 * or across hidden marker text from it, where placement picks the side. Anywhere else is an engine
 * insert the typing decision (`components/blocks/editable/typed-insert.ts`) has to take.
 */

import { type InvariantViolation } from '@voithos-labs/aragonite/dev-checks';

export interface TypedInsertReadBack {
	/** The block's displayed text before the insert, and as the browser left it. */
	before: string;
	after: string;
	/** The raw offset the caret sat at when the insert began. */
	caret: number;
	/** The raw offset of every character the screen shows in `after`. */
	visible: readonly number[];
	/** The text the input carried. */
	data: string;
}

export function checkTypedInsertAtCaret(read: TypedInsertReadBack): InvariantViolation | null {
	const { before, after, caret, visible } = read;
	const grown = after.length - before.length;
	if (grown <= 0) return null;
	// The offsets the insert could have gone in at: a run of equal characters allows several.
	let first = 0;
	while (first < before.length && before[first] === after[first]) first++;
	let fromEnd = 0;
	while (fromEnd < before.length && before.at(-1 - fromEnd) === after.at(-1 - fromEnd)) fromEnd++;
	const lowest = before.length - fromEnd;
	if (lowest > first) return null;
	if (caret >= lowest && caret <= first) return null;
	// The bytes between the caret and the landing, in `after`'s offsets, must all be hidden.
	const [from, to] = caret < lowest ? [caret, lowest] : [first + grown, caret + grown];
	if (!visible.some((raw) => raw >= from && raw < to)) return null;
	const landed = caret < lowest ? lowest : first;
	return {
		code: 'typed-insert-at-caret',
		message: `typed ${JSON.stringify(read.data)} landed at ${landed}, away from the caret at ${caret}: the typing decision should have written it at the caret`,
		detail: { data: read.data, caret, landed }
	};
}

/**
 * Changes to a text as runs of bytes: the change between two texts, a text with changes made, and
 * the whole lines a change writes or takes. The byte splice reads its windows from these.
 */

import { splitLines } from '../core/lines';
import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';

/** One run of the current bytes replaced: `[from, to)` gives way to `insert`. */
export interface ByteChange {
	from: number;
	to: number;
	insert: string;
}

/** `after` as changes to `before`: none when they're equal, else the one run between their
 *  shared start and end. */
export function changesBetween(before: string, after: string): ByteChange[] {
	if (before === after) return [];
	const shorter = Math.min(before.length, after.length);
	const from = sharedPrefixLength(before, after, shorter);
	const tail = sharedSuffixLength(before, after, shorter - from);
	return [{ from, to: before.length - tail, insert: after.slice(from, after.length - tail) }];
}

/** `before[from, to)` with `made`, the changes inside it, made. */
export function changedBytes(
	before: string,
	from: number,
	to: number,
	made: readonly ByteChange[]
): string {
	let text = '';
	let at = from;
	for (const change of made) {
		text += before.slice(at, change.from) + change.insert;
		at = change.to;
	}
	return text + before.slice(at, to);
}

/** `change` cut down to the bytes it changes, so a range wider than them names only what moved. */
export const narrowed = (before: string, { from, to, insert }: ByteChange): ByteChange[] =>
	changesBetween(before.slice(from, to), insert).map((c) => ({
		from: from + c.from,
		to: from + c.to,
		insert: c.insert
	}));

/** The whole lines `change` leaves where it was made. */
export function writtenLines(before: string, change: ByteChange): string[] {
	const from = before.lastIndexOf('\n', change.from - 1) + 1;
	// Through the line break, so a CRLF line's `\r` leaves with its ending.
	const end = before.indexOf('\n', change.to);
	const rest = before.slice(change.to, end < 0 ? before.length : end + 1);
	return splitLines(before.slice(from, change.from) + change.insert + rest).map((l) => l.text);
}

/** The whole lines of `before` that `change` writes over. */
export function takenLines(before: string, change: ByteChange): string[] {
	const from = before.lastIndexOf('\n', change.from - 1) + 1;
	const end = before.indexOf('\n', change.to);
	return splitLines(before.slice(from, end < 0 ? before.length : end + 1)).map((l) => l.text);
}

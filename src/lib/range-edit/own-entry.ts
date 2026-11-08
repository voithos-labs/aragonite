/**
 * The editor's own clipboard entry: the bytes a cut of the range changes, with what the cut left in
 * their place and hashes of what stands around them, so a paste of it where that cut left its caret,
 * or over the range it came from, puts those bytes back exactly. Anywhere else it doesn't match and
 * the clipboard's text pastes alone. It reads only the removal's bytes, so a copy reads nothing new.
 */

import { sharedPrefixLength, sharedSuffixLength } from '../core/written-span';
import { hashSource } from '../core/string-hash';
import type { Edit } from './leaf-splice';

/** Bytes of surroundings that identify where the entry belongs. */
const AROUND = 64;

/** The entry for `[from, to)` of `source`, whose removal gave `cut`, its caret before it lands. */
export function ownEntry(source: string, from: number, to: number, cut: Edit): string {
	const after = cut.source;
	const start = sharedPrefixLength(source, after, Math.min(from, cut.caret));
	const most = Math.min(source.length - Math.max(start, to), after.length - cut.caret);
	const tail = sharedSuffixLength(source, after, most);
	const left = after.length - tail;
	const lead = Math.min(AROUND, start);
	const trail = Math.min(AROUND, tail);
	const head = [
		after.length,
		from - start,
		to - start,
		cut.caret - start,
		left - start,
		lead,
		trail
	];
	const marks = [
		hashSource(after.slice(start - lead, start)),
		hashSource(after.slice(start, left)),
		hashSource(after.slice(left, left + trail))
	].join(' ');
	return `${head.join(' ')} ${marks}\n${source.slice(start, source.length - tail)}`;
}

/** What a paste of the entry over `[from, to)` gives: at the caret its cut left, the cut undone;
 *  over its own range, nothing changed; null anywhere else. */
export function restored(source: string, from: number, to: number, own: string): Edit | null {
	const entry = /^(\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\d+) (\w+) (\w+) (\w+)\n/.exec(own);
	if (!entry) return null;
	const [length, rangeFrom, rangeTo, caret, left, lead, trail] = entry.slice(1, 8).map(Number);
	const [before, middle, after] = entry.slice(8);
	const bytes = own.slice(entry[0].length);
	// The source the entry fits is as long as the cut left it, or as long as it was before.
	const grown = from === to ? 0 : bytes.length - left;
	const fits = (start: number, end: number, inside: string) =>
		source.length === length + grown &&
		start >= lead &&
		end + trail <= source.length &&
		hashSource(source.slice(start - lead, start)) === before &&
		inside === middle &&
		hashSource(source.slice(end, end + trail)) === after;
	if (from === to) {
		const start = from - caret;
		const end = start + left;
		if (!fits(start, end, hashSource(source.slice(start, end)))) return null;
		return { source: source.slice(0, start) + bytes + source.slice(end), caret: start + rangeTo };
	}
	const start = from - rangeFrom;
	const end = start + bytes.length;
	if (to - start !== rangeTo || source.slice(start, end) !== bytes) return null;
	return fits(start, end, middle) ? { source, caret: to } : null;
}

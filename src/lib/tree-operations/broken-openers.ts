/**
 * The removal mirror of `written-openers.ts`: a selection removed over a `:::` container's opening
 * row that leaves the row fewer colons than open a container takes the rest of the row's syntax
 * and the closing line with it, so what is left of the title stands as a paragraph over the body
 * (`docs/design/structural-edits.md` § Reserved chrome). The leaf write's ancestor rebuild and the
 * range-edit core both ask it, so a cut's own clipboard entry fits the bytes the cut leaves.
 */

import { isBlankText, ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { isDirectiveCloser } from '../core/directive/grammar';

/** A write over the row's bytes `[start, end)`, a selection, that put `inserted` in their place. */
export interface RowCut {
	readonly start: number;
	readonly end: number;
	readonly inserted: string;
}

/** The fewest colons that open a container; two open a leaf directive. */
const CONTAINER_COLONS = 3;

const colonsAt = (text: string): number => /^:*/.exec(text)![0].length;

/** The cut a write over the selection `[start, end)` of `before` made, read off the bytes `after`
 *  it left; null where those bytes don't keep what stood either side of the selection. */
export function cutOf(before: string, after: string, start: number, end: number): RowCut | null {
	const kept = before.length - end;
	if (start >= end || after.length < start + kept) return null;
	if (!after.startsWith(before.slice(0, start)) || !after.endsWith(before.slice(end))) return null;
	return { start, end, inserted: after.slice(start, after.length - kept) };
}

/** Whether `cut`, which left `written`, breaks the opener `row` whose marker ends at `markerEnd`:
 *  with the selection out and before its text, fewer colons than a container needs are left. */
export function breaksOpener(
	row: string,
	written: string,
	markerEnd: number,
	cut: RowCut
): boolean {
	const colons = colonsAt(row);
	if (cut.start >= markerEnd || colons < CONTAINER_COLONS) return false;
	// The colons before the selection run on into those after it.
	const left = cut.start < colons ? cut.start + colonsAt(row.slice(cut.end)) : colons;
	if (left >= CONTAINER_COLONS) return false;
	// A write that still opens with the whole marker took none of it: a live selection of the
	// title's whole text keeps `:::name `.
	return !written.startsWith(row.slice(0, markerEnd));
}

/** Container `raw` unwrapped once `cut` broke its row: the text and the title past the cut, a blank
 *  line where `apart` asks one, the body less its closer; the caret after the text; any title left. */
export function unwrappedContainer(
	raw: string,
	row: string,
	markerEnd: number,
	cut: RowCut,
	apart: (title: string, body: string) => boolean
): { bytes: string; caret: number; titled: boolean } {
	const ending = ownTrailingLineEnding(row) || '\n';
	const title = cut.inserted + trimTrailingLineEnding(row).slice(Math.max(cut.end, markerEnd));
	const body = bodyOf(raw.slice(row.length), colonsAt(row));
	const head = /\S/.test(title) ? title + ending : '';
	const seam = head && body && apart(head, body) ? ending : '';
	const bytes = head + seam + body || ending;
	// A container saved without a final line ending leaves none behind it either.
	const unended = ownTrailingLineEnding(raw) === '' && bytes !== ending;
	return {
		bytes: unended ? trimTrailingLineEnding(bytes) : bytes,
		caret: head ? cut.inserted.length : 0,
		titled: head !== ''
	};
}

/** The lines under the opening row, less the closing line that closes `colons`; '' when blank. */
function bodyOf(inner: string, colons: number): string {
	const display = trimTrailingLineEnding(inner);
	const lastStart = display.lastIndexOf('\n') + 1;
	const closed = isDirectiveCloser(display.slice(lastStart).replace(/[ \t]+$/, ''), colons);
	const body = closed ? inner.slice(0, lastStart) : inner;
	return isBlankText(body) ? '' : body;
}

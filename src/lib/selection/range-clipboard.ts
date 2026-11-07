/**
 * What a copy or a cut of a range writes: the range-edit core's copy of the range's bytes, and the
 * editor's own entry beside it, for a range across blocks and a range inside one block alike.
 */

import type { DocumentView } from '../core/node-views';
import { serialize } from '../core/serializer';
import { hidesDelimitersAtCaret } from '../presentation-mode';
import type { Reading } from '../schema/reading';
import type { ClipboardWrite } from '../browser/clipboard';
import type { RawRange } from '../browser/offsets';
import { copyRange } from '../range-edit/edit-range';
import { rangeHost, type Mode } from '../range-edit/host';
import { rangeBytes } from './range-bytes';
import { coverRange, rangeCoverage, type RangeCoverage } from './range-coverage';

/** The copy of a covered range; null for a rectangle of cells, which copies as a grid. */
export function rangeClipboard(
	doc: DocumentView,
	coverage: RangeCoverage,
	reading: Reading
): ClipboardWrite | null {
	const source = serialize(doc);
	const mode: Mode = hidesDelimitersAtCaret(reading.mode()) ? 'live' : 'source';
	const host = rangeHost(reading, { source, tree: doc });
	const range = rangeBytes(doc, source, coverage, host.layout(doc));
	if (!range) return null;
	const { clipboard, own } = copyRange(source, range, mode, host);
	return { text: clipboard, own };
}

/** The copy of `range` of the text block at `path`. */
export function blockRangeClipboard(
	doc: DocumentView,
	path: readonly number[],
	range: RawRange,
	reading: Reading
): ClipboardWrite | null {
	const start = { path: path.slice(), offset: range.start };
	const end = { path: path.slice(), offset: range.end };
	return rangeClipboard(doc, rangeCoverage(doc, coverRange(doc, start, end)), reading);
}

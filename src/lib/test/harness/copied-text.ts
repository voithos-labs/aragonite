// The text a copy of a range puts on the clipboard, read through the editor's own coverage and
// the range-edit core, for a test that copies without mounting an editor.

import type { DocumentView } from '#lib/core/node-views.js';
import type { Reading } from '#lib/schema/reading.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { rangeClipboard } from '#lib/selection/range-clipboard.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';

/** The copy's text from `a` to `b`; empty for a rectangle of cells, which the grid copy owns. */
export function copiedText(
	doc: DocumentView,
	a: SelectionPoint,
	b: SelectionPoint,
	reading: Reading
): string {
	return rangeClipboard(doc, rangeCoverage(doc, coverRange(doc, a, b)), reading)?.text ?? '';
}

// The text a copy of a range puts on the clipboard, read through the editor's own coverage and
// the range-edit core, for a test that copies without mounting an editor.

import type { DocumentView } from '#lib/core/node-views.js';
import { serialize } from '#lib/core/serializer.js';
import type { Reading } from '#lib/schema/reading.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import { documentBytes, type DocumentBytes } from '#lib/selection/range-bytes.js';
import { rangeClipboard } from '#lib/selection/range-clipboard.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';

/** The document's bytes read afresh at every question, for a test whose document changes under it. */
export function freshBytes(getDoc: () => DocumentView): DocumentBytes {
	let reads = 0;
	return documentBytes({
		version: () => ++reads,
		doc: getDoc,
		source: () => serialize(getDoc()),
		measured: () => measured(getDoc())
	});
}

/** The copy's text from `a` to `b`; empty for a rectangle of cells, which the grid copy owns. */
export function copiedText(
	doc: DocumentView,
	a: SelectionPoint,
	b: SelectionPoint,
	reading: Reading
): string {
	const coverage = rangeCoverage(doc, coverRange(doc, a, b));
	return (
		rangeClipboard(
			freshBytes(() => doc),
			coverage,
			reading
		)?.text ?? ''
	);
}

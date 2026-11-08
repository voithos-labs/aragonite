// A range delete between two points, as the editor's removal runs it: cover the range, read it as
// bytes, and take the range-edit core's answer. Table endpoints must be cell points, as
// `SelectionState` hands them over.

import type { Document } from '#lib/core/nodes.js';
import type { DocumentView } from '#lib/core/node-views.js';
import type { Reading } from '#lib/schema/reading.js';
import type { ScopeWrites } from '#lib/action-contracts.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import type { RemovalGesture } from '#lib/selection/caret-target.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { pointAtByte, removalBytes } from '#lib/selection/range-bytes.js';
import { numberedOn } from '#lib/selection/cross-block/range-removal.js';
import { removalOf, type RemovalGesture as CoreGesture } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { serialize } from '#lib/core/serializer.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { hidesDelimitersAtCaret } from '#lib/presentation-mode.js';
import type { SharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from './fixture-grammar';

export interface RangeDeleteOptions {
	sharing?: SharingState;
	reading?: Reading;
	gesture?: RemovalGesture;
	/** Unused: the core answers in bytes, which no commit scope writes. */
	scope?: ScopeWrites;
}

export interface RangeDeleteResult {
	newDoc: Document;
	caret: (committed: DocumentView) => SelectionPoint | null;
}

const CORE: Record<RemovalGesture, CoreGesture> = {
	Backspace: 'backspace',
	Delete: 'delete',
	cut: 'cut',
	keyless: 'command'
};

export function deleteRange(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	{ reading = fixtureReading(), gesture = 'keyless' }: RangeDeleteOptions = {}
): RangeDeleteResult {
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const source = serialize(doc);
	const layout = documentLayout(doc);
	const range = removalBytes(doc, coverage, layout);
	if (!range) throw new Error('deleteRange: a range of cells never reaches the core');
	const mode = hidesDelimitersAtCaret(reading.mode()) ? 'live' : 'source';
	const host = rangeHost(reading, { source, tree: doc, layout });
	const answer = removalOf(source, range, CORE[gesture], mode, host);
	const bytes = numberedOn(doc, layout, source, range, answer.source);
	const newDoc = readAsOpened(bytes, { grammar: reading.grammar, scope: 'document' }) as Document;
	return { newDoc, caret: (committed) => pointAtByte(committed, answer.caret.at) };
}

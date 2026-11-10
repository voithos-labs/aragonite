// A range delete between two points, as the editor's removal runs it: cover the range, read it as
// bytes, take the range-edit core's answer and write it into `doc` in place, as the byte splice
// writes it (a closing line under an opener it writes included). Table endpoints must be cell
// points, as `SelectionState` hands them over.

import type { Document } from '#lib/core/nodes.js';
import type { DocumentView } from '#lib/core/node-views.js';
import type { Reading } from '#lib/schema/reading.js';
import type { ScopeWrites } from '#lib/action-contracts.js';
import type { SelectionPoint } from '#lib/selection/primitives.js';
import type { RemovalGesture } from '#lib/selection/caret-target.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { pointAtByte, removalBytes } from '#lib/selection/range-bytes.js';
import { CORE_GESTURE, type Removed } from '#lib/selection/cross-block/range-removal.js';
import { removalOf } from '#lib/range-edit/edit-range.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { serialize } from '#lib/core/serializer.js';
import { changesBetween, changedBytes } from '#lib/tree-operations/byte-changes.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { splicedOpenerClosers, withSplicedClosers } from '#lib/tree-operations/spliced-openers.js';
import { offsetPastClosers } from '#lib/tree-operations/written-openers.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { hidesDelimitersAtCaret } from '#lib/presentation-mode.js';
import type { SharingState } from '#lib/tree-operations/sharing.js';
import { fixtureReading } from './fixture-grammar';
import { measured } from '#lib/tree-operations/top-level-starts.js';

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
	/** What `removeThroughCore` reports beside its caret: the core's caret and the block it took. */
	removed: Pick<Removed, 'wrote' | 'landed' | 'took'>;
}

export function deleteRange(
	doc: Document,
	start: SelectionPoint,
	end: SelectionPoint,
	{ reading = fixtureReading(), gesture = 'keyless' }: RangeDeleteOptions = {}
): RangeDeleteResult {
	const coverage = rangeCoverage(doc, coverRange(doc, start, end));
	const source = serialize(doc);
	const layout = documentLayout(measured(doc));
	const range = removalBytes(doc, coverage, layout);
	if (!range) throw new Error('deleteRange: a range of cells never reaches the core');
	const mode = hidesDelimitersAtCaret(reading.mode()) ? 'live' : 'source';
	const host = rangeHost(reading, { source, tree: doc, layout });
	const answer = removalOf(source, range, CORE_GESTURE[gesture], mode, host);
	const changes = changesBetween(source, answer.source);
	const read = spliceReading(doc, source, changes, reading.grammar);
	const closers = read ? splicedOpenerClosers(doc, source, changes, read, reading.grammar) : [];
	const written = withSplicedClosers(source, changes, closers);
	const bytes = changedBytes(source, 0, source.length, written);
	const opened = readAsOpened(bytes, { grammar: reading.grammar, scope: 'document' }) as Document;
	Object.assign(doc, { prefix: opened.prefix, children: opened.children, suffix: opened.suffix });
	const at = offsetPastClosers(answer.caret.at, closers);
	const removed = {
		wrote: true,
		landed: { ...answer.caret, at },
		took: answer.took ?? null
	};
	return { newDoc: doc, caret: (committed) => pointAtByte(measured(committed), at), removed };
}

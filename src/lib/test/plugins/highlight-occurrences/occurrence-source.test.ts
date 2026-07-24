// The memoizing occurrence source: the expensive word index builds once per edit
// epoch; selection changes within one epoch re-filter the cached index without
// rebuilding it. `onScan` is the spy seam — it fires only on a real rebuild.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { EditorSelection, MarkDecoration } from '$lib/plugin';
import {
	createOccurrenceSource,
	type OccurrenceSource
} from '$lib/plugins/highlight-occurrences/occurrence-source';
import { OCCURRENCE_CLASS } from '$lib/plugins/highlight-occurrences/occurrences';

function caret(path: number[], offset: number): EditorSelection {
	const point = { path, offset };
	return { anchor: point, focus: point };
}

// The source's provide is typed to the widened Decoration[] contract; occurrences
// only ever emit marks, so read them back as marks.
function provideMarks(
	source: OccurrenceSource['source'],
	doc: ReturnType<typeof parse>,
	editEpoch: number
): MarkDecoration[] {
	return source.provide(doc, { editEpoch }) as MarkDecoration[];
}

function markPaths(marks: MarkDecoration[]): number[][] {
	return marks.map((m) => m.path);
}

describe('createOccurrenceSource', () => {
	const doc = parse('cat sat on cat\n\ndog ran\n');

	it('scans once per epoch across many selection-change invalidates', () => {
		let scans = 0;
		const { source, setSelection } = createOccurrenceSource({ onScan: () => scans++ });

		// One edit epoch, five caret moves (each a setSelection + invalidate the engine
		// turns into a provide call with the same editEpoch).
		for (let i = 0; i < 5; i++) {
			setSelection(caret([0], 0));
			provideMarks(source, doc, 7);
		}
		expect(scans).toBe(1);
	});

	it('re-filters to the newly selected word within one epoch, no rescan', () => {
		let scans = 0;
		const { source, setSelection } = createOccurrenceSource({ onScan: () => scans++ });

		setSelection(caret([0], 0)); // 'cat'
		expect(markPaths(provideMarks(source, doc, 1))).toEqual([[0], [0]]);

		setSelection(caret([1], 0)); // 'dog' — same epoch
		expect(markPaths(provideMarks(source, doc, 1))).toEqual([[1]]);

		expect(scans).toBe(1);
	});

	it('rebuilds the index when the epoch bumps, reading the new document', () => {
		let scans = 0;
		const { source, setSelection } = createOccurrenceSource({ onScan: () => scans++ });
		setSelection(caret([0], 0)); // 'cat', a 3-char word in `doc`

		expect(provideMarks(source, doc, 1).every((m) => m.end - m.start === 3)).toBe(true);
		expect(scans).toBe(1);

		// A later edit rewrote the block; the bumped epoch must re-read it, so the
		// caret now resolves 'bird' (4 chars) against the fresh index, not the stale one.
		const edited = parse('bird sat on bird\n\ndog ran\n');
		const marks = provideMarks(source, edited, 2);
		expect(scans).toBe(2);
		expect(marks).toHaveLength(2);
		expect(marks.every((m) => m.end - m.start === 4)).toBe(true);
	});

	it('emits the occurrence class and returns nothing for a wordless caret', () => {
		const { source, setSelection } = createOccurrenceSource();
		setSelection(caret([0], 0));
		expect(provideMarks(source, doc, 1)[0].class).toBe(OCCURRENCE_CLASS);

		setSelection(null);
		expect(provideMarks(source, doc, 1)).toEqual([]);
	});
});

// The caching occurrence source: the expensive word index builds once per `editEpoch`;
// selection changes within one re-filter the cached index without rebuilding it. `onScan` is
// what a test watches, and it fires only on a real rebuild.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib';
import type { EditorSelection, MarkDecoration } from '#lib/plugin.js';
import {
	createOccurrenceSource,
	type OccurrenceSource
} from '#lib/plugins/highlight-occurrences/occurrence-source.js';
import { OCCURRENCE_CLASS } from '#lib/plugins/highlight-occurrences/occurrences.js';

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

		// One `editEpoch`, five caret moves (each a setSelection plus invalidate, which the
		// decoration system turns into a provide call with the same `editEpoch`).
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
		const { source, setSelection, noteEdit } = createOccurrenceSource({ onScan: () => scans++ });
		setSelection(caret([0], 0)); // 'cat', a 3-char word in `doc`

		expect(provideMarks(source, doc, 1).every((m) => m.end - m.start === 3)).toBe(true);
		expect(scans).toBe(1);

		// A structural edit rewrote the block, so its `editEpoch` paints rather than stepping
		// aside: the caret resolves 'bird' (4 chars) against the fresh index, not the stale one.
		noteEdit('replaceBlock');
		const edited = parse('bird sat on bird\n\ndog ran\n');
		const marks = provideMarks(source, edited, 2);
		expect(scans).toBe(2);
		expect(marks).toHaveLength(2);
		expect(marks.every((m) => m.end - m.start === 4)).toBe(true);
	});

	// The cache lives in the source's own closure, so the second scan must inherit the
	// first's token lists rather than starting from an empty one.
	it('carries its token cache across epochs, re-tokenizing only the changed leaf', () => {
		const tokenized: number[] = [];
		const { source, setSelection } = createOccurrenceSource({
			onScan: (stats) => tokenized.push(stats.tokenizedLeaves)
		});
		setSelection(caret([0], 0));

		provideMarks(source, doc, 1);
		provideMarks(source, parse('cat sat on cat\n\ndog rans\n'), 2);

		expect(tokenized).toEqual([2, 1]);
	});

	it('emits the occurrence class and returns nothing for a wordless caret', () => {
		const { source, setSelection } = createOccurrenceSource();
		setSelection(caret([0], 0));
		expect(provideMarks(source, doc, 1)[0].class).toBe(OCCURRENCE_CLASS);

		setSelection(null);
		expect(provideMarks(source, doc, 1)).toEqual([]);
	});
});

// Marks step aside for a keystroke, the one change that bumps `editEpoch` unannounced.
// Miss-analysis: no unit test reached the source through an `edit` op.
describe('createOccurrenceSource typing gate', () => {
	const doc = parse('cat sat on cat\n\ndog ran\n');

	it('hides the marks on an epoch that arrived with no edit event', () => {
		const { source, setSelection } = createOccurrenceSource();
		setSelection(caret([0], 0));
		expect(provideMarks(source, doc, 1)).toHaveLength(2);

		expect(provideMarks(source, doc, 2)).toEqual([]);
	});

	it('keeps them hidden through the next keystroke, and paints them again when typing pauses', () => {
		const { source, setSelection, noteEdit, noteTypingPause } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);
		expect(noteEdit('input')).toBe(false);
		expect(provideMarks(source, doc, 2)).toEqual([]);
		expect(noteEdit('input')).toBe(false);
		expect(provideMarks(source, doc, 3)).toEqual([]);

		expect(noteTypingPause()).toBe(true); // asks the wiring for the repaint
		expect(provideMarks(source, doc, 3)).toHaveLength(2);
		expect(noteTypingPause()).toBe(false); // already painted, nothing to reveal
	});

	// A replace-all names its one op after its commits' epochs have arrived. The marks must come
	// back on the op, not only on the next one.
	it('paints them again when a structural op lands after its own epoch', () => {
		const { source, setSelection, noteEdit } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);
		expect(provideMarks(source, doc, 2)).toEqual([]);

		expect(noteEdit('replaceBlock')).toBe(true);
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	it('never hides the epoch a structural op announced ahead of', () => {
		const { source, setSelection, noteEdit } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		expect(noteEdit('paste')).toBe(false); // nothing held back to reveal
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	// The `sourceSwap` event fires before the swap's `editEpoch` arrives, and a host may place a
	// caret in the new document before that epoch lands.
	it('never hides the epoch a source swap announced ahead of, caret or none', () => {
		const { source, setSelection, noteSourceSwap } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		expect(noteSourceSwap()).toBe(false); // nothing held back to reveal
		const swapped = parse('dog sat on dog\n');
		expect(provideMarks(source, swapped, 2)).toHaveLength(2);
	});

	it('paints held marks again when a source swap lands after a keystroke epoch', () => {
		const { source, setSelection, noteSourceSwap } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);
		expect(provideMarks(source, doc, 2)).toEqual([]);

		expect(noteSourceSwap()).toBe(true);
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	it('rebuilds the index on every hidden epoch, so the pause paints fresh marks', () => {
		const tokenized: number[] = [];
		const { source, setSelection, noteTypingPause } = createOccurrenceSource({
			onScan: (stats) => tokenized.push(stats.tokenizedLeaves)
		});
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		const typed = parse('cat sat on cat\n\ndog rans\n');
		expect(provideMarks(source, typed, 2)).toEqual([]);
		expect(tokenized).toEqual([2, 1]); // the hidden epoch still re-tokenized its leaf

		noteTypingPause();
		expect(provideMarks(source, typed, 2)).toHaveLength(2);
		expect(tokenized).toEqual([2, 1]); // and the pause reused that rebuild
	});
});

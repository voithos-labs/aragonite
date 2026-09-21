// The caching occurrence source: the expensive word index builds once per `editEpoch`;
// selection changes within one re-filter the cached index without rebuilding it. `onScan` is
// what a test watches, and it fires only on a real rebuild.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib';
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

// The marks step aside while you type. A keystroke happens under a caret and bumps
// `editEpoch` with no `edit` event before it; every other document change fails one of those
// two, so the marks stay on. Miss-analysis: no unit test reached the source through an `edit`
// op at all, so nothing told a keystroke apart from an undo or a whole-document swap.
describe('createOccurrenceSource typing gate', () => {
	const doc = parse('cat sat on cat\n\ndog ran\n');

	it('hides the marks on an epoch that arrived with no edit event', () => {
		const { source, setSelection } = createOccurrenceSource();
		setSelection(caret([0], 0));
		expect(provideMarks(source, doc, 1)).toHaveLength(2);

		expect(provideMarks(source, doc, 2)).toEqual([]);
	});

	it('paints them again when the typing burst flushes its input event', () => {
		const { source, setSelection, noteEdit } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);
		expect(provideMarks(source, doc, 2)).toEqual([]);

		expect(noteEdit('input')).toBe(true); // asks the wiring for the repaint
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
		expect(noteEdit('input')).toBe(false); // already painted, nothing to reveal
	});

	// Undo bumps the content version before it emits, so its op can arrive after the
	// `editEpoch` it caused. The marks must come back on the op, not only on the next one.
	it('paints them again when a structural op lands after its own epoch', () => {
		const { source, setSelection, noteEdit } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);
		expect(provideMarks(source, doc, 2)).toEqual([]);

		expect(noteEdit('undo')).toBe(true);
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	it('never hides the epoch a structural op announced ahead of', () => {
		const { source, setSelection, noteEdit } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		expect(noteEdit('paste')).toBe(false); // nothing held back to reveal
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	// A whole-document swap announces no op at all; it drops the caret before its
	// `editEpoch` arrives, and that is what separates it from a keystroke.
	it('never hides an epoch that arrived with no caret', () => {
		const { source, setSelection } = createOccurrenceSource();
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		setSelection(null);
		expect(provideMarks(source, doc, 2)).toEqual([]); // no anchor word, not a hold

		setSelection(caret([0], 0)); // the click into the swapped-in document
		expect(provideMarks(source, doc, 2)).toHaveLength(2);
	});

	it('rebuilds the index on every hidden epoch, so the flush paints fresh marks', () => {
		const tokenized: number[] = [];
		const { source, setSelection, noteEdit } = createOccurrenceSource({
			onScan: (stats) => tokenized.push(stats.tokenizedLeaves)
		});
		setSelection(caret([0], 0));
		provideMarks(source, doc, 1);

		const typed = parse('cat sat on cat\n\ndog rans\n');
		expect(provideMarks(source, typed, 2)).toEqual([]);
		expect(tokenized).toEqual([2, 1]); // the hidden epoch still re-tokenized its leaf

		noteEdit('input');
		expect(provideMarks(source, typed, 2)).toHaveLength(2);
		expect(tokenized).toEqual([2, 1]); // and the flush reused that rebuild
	});
});

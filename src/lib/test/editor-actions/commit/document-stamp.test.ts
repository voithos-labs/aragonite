import { describe, it, expect } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import { createDocumentStamps, stampWrites } from '#lib/editor-actions/commit/document-stamp.js';
import { makeTopHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '../../support/warn-gate';

// A write made for a document a swap replaced is refused at the write gate, quietly, whichever
// route it takes, and a write made for the document in place is not.
function stampedTop(source: string) {
	const h = makeTopHarness(source);
	const stamps = h.deps.stamps;
	const actions = stampWrites(h.actions, stamps.current(), stamps);
	return { ...h, stamps, stamped: actions };
}

describe('stampWrites', () => {
	it('runs each method as a write made for its stamp, and reads other members through', () => {
		const stamps = createDocumentStamps();
		const stamp = stamps.current();
		const seen: unknown[] = [];
		const handles = stampWrites(
			{ label: 'x', write: () => seen.push(stamps.active()) },
			stamp,
			stamps
		);
		handles.write();
		expect(seen).toEqual([stamp]);
		expect(handles.label).toBe('x');
		expect(stamps.active()).toBeNull();
	});
});

describe('a write made for a swapped-out document', () => {
	it('is refused on the in-place keystroke route, with no warning', async () => {
		const h = stampedTop('a\n');
		h.stamps.retire();

		const write = h.stamped.updateBlockContent(0, 'ab\n', 'authored', 'join-typing', 1);
		await write;

		expect(write.admitted).toBe(false);
		expect(serialize(h.deps.doc)).toBe('a\n');
		expect(h.edits).toEqual([]);
		expect(h.deps.undoManager.canUndo).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});

	it('is refused on the commit route', async () => {
		const h = stampedTop('ab\n');
		h.stamps.retire();

		expect(await h.stamped.splitBlock(0, 1)).toBe(false);
		expect(serialize(h.deps.doc)).toBe('ab\n');
		expect(takeDevWarns()).toEqual([]);
	});

	it('lands when made for the document in place, stamped or not', async () => {
		const h = stampedTop('a\n');
		await h.stamped.updateBlockContent(0, 'ab\n', 'authored', 'join-typing', 1);
		h.stamps.retire();
		await h.actions.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);

		expect(serialize(h.deps.doc)).toBe('abc\n');
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('a write made after the editor unmounted', () => {
	it('is refused, stamped or not, with no warning', async () => {
		const h = stampedTop('a\n');
		h.stamps.end();

		const stamped = h.stamped.updateBlockContent(0, 'ab\n', 'authored', 'join-typing', 1);
		await stamped;
		expect(await h.actions.splitBlock(0, 1)).toBe(false);

		expect(stamped.admitted).toBe(false);
		expect(serialize(h.deps.doc)).toBe('a\n');
		expect(h.edits).toEqual([]);
		expect(h.deps.undoManager.canUndo).toBe(false);
		expect(takeDevWarns()).toEqual([]);
	});
});

// Miss-analysis: the gate's rows covered swapped-out and unmounted documents, never a write made
// while an undo was putting its entry back.
describe('a write made while an undo or redo installs its entry', () => {
	it('is refused on the keystroke and commit routes, pushing nothing, with no warning', async () => {
		const h = stampedTop('ab\n');
		let keystroke: ReturnType<typeof h.actions.updateBlockContent> | undefined;
		let split: Promise<boolean> | undefined;
		await h.stamps.duringHistorySwap(async () => {
			keystroke = h.actions.updateBlockContent(0, 'abc\n', 'authored', 'join-typing', 2);
			split = h.actions.splitBlock(0, 1);
		});

		expect(keystroke!.admitted).toBe(false);
		expect(await split!).toBe(false);
		expect(serialize(h.deps.doc)).toBe('ab\n');
		expect(h.deps.undoManager.getStacks().undo).toEqual([]);
		expect(takeDevWarns()).toEqual([]);
	});

	it('lands once the install has ended', async () => {
		const h = stampedTop('ab\n');
		await h.stamps.duringHistorySwap(async () => {});
		expect(await h.actions.splitBlock(0, 1)).toBe(true);
	});
});

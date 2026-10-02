import { describe, it, expect } from 'vitest';
import { serialize } from '$lib/core/serializer';
import { createDocumentStamps, stampWrites } from '$lib/editor-actions/commit/document-stamp';
import { makeTopHarness } from '$lib/test/harness/editor-actions';
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

		const write = h.stamped.updateBlockContent(0, 'ab\n', 'authored', 1);
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
		await h.stamped.updateBlockContent(0, 'ab\n', 'authored', 1);
		h.stamps.retire();
		await h.actions.updateBlockContent(0, 'abc\n', 'authored', 2);

		expect(serialize(h.deps.doc)).toBe('abc\n');
		expect(takeDevWarns()).toEqual([]);
	});
});

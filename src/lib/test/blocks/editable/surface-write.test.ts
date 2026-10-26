// The one write a block makes to its own text puts the caret back only where the write left the
// block as it was: a write that changed the kind or merged lands the caret itself, and a second
// restore would fight that landing.
// Miss-analysis: every write site parked a caret on `admitted` alone, and no test stubbed a write
// that reported it had placed the caret, so the field had no reader and nothing noticed.
import { describe, expect, it, vi } from 'vitest';
import type { BlockEditActions } from '#lib/action-contracts.js';
import type { NodeView } from '#lib/core/node-views.js';
import {
	createSurfaceWrite,
	rangeWrite,
	type TextWrite
} from '#lib/components/blocks/editable/surface-write.js';
import { withStoredCaret } from '#lib/editor-actions/stored-caret.js';
import { stubBlockEdit } from '#lib/testing/headless-actions.js';
import { createInsertionRecords } from '#lib/caret/next-insertion.js';

const TYPED: Omit<TextWrite, 'text' | 'caretAfter'> = {
	intent: 'typed',
	history: 'join-typing',
	mode: 'authored',
	source: 'input'
};

/** A block holding `raw` whose list answers every write with `keepsCaret`. */
function writerOver(raw: string, keepsCaret: boolean) {
	const node: NodeView = { kind: 'paragraph', leadingTrivia: '', raw };
	const requestCaret = vi.fn();
	const blockEdit: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (_index, _text, _mode, _history, _before, after = 0) =>
			withStoredCaret(Promise.resolve(true), after, undefined, keepsCaret)
	};
	const writeText = createSurfaceWrite({
		getNode: () => node,
		getIndex: () => 0,
		getPath: () => [0],
		blockEdit,
		kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
		getPreEditOffset: () => 0,
		requestCaret,
		holdInsertion: () => createInsertionRecords([]).hold({}, null)
	});
	return { writeText, requestCaret };
}

describe('the caret after a surface write', () => {
	it('is put back where a write in place left it', () => {
		const { writeText, requestCaret } = writerOver('ab\n', true);
		void writeText({ ...TYPED, text: 'abc', caretAfter: 3 });
		expect(requestCaret).toHaveBeenCalledWith(3, { source: 'input' });
	});

	it('is left to a write that places it itself', () => {
		const { writeText, requestCaret } = writerOver('ab\n', false);
		void writeText({ ...TYPED, text: '# ab', caretAfter: 2 });
		expect(requestCaret).not.toHaveBeenCalled();
	});

	it('is left alone by a key that keeps its widget selected', () => {
		const { writeText, requestCaret } = writerOver('ab\n', true);
		void writeText({ ...TYPED, text: 'abc', caretAfter: 3, leavesCaret: true });
		expect(requestCaret).not.toHaveBeenCalled();
	});
});

// Miss-analysis: every range edit ran in a block saved with a line ending, so none cut a last line
// down to a hard break's open line and lost the ending the edit left.
describe('rangeWrite: the text a range edit hands the surface write', () => {
	const paragraph = (raw: string): NodeView => ({ kind: 'paragraph', leadingTrivia: '', raw });

	it('takes off only the block’s own ending, which the write adds back', () => {
		expect(rangeWrite(paragraph('ab\n'), { raw: 'a\n', caret: 1 })).toEqual({
			text: 'a',
			caretAfter: 1
		});
	});

	it('takes off a CRLF ending whole', () => {
		expect(rangeWrite(paragraph('ab\r\n'), { raw: 'a\r\n', caret: 1 }).text).toBe('a');
	});

	it('keeps a line ending the edit leaves at the end of a block saved without one', () => {
		expect(rangeWrite(paragraph('a\\\nb'), { raw: 'a\\\n', caret: 3 }).text).toBe('a\\\n');
		expect(rangeWrite(paragraph('a\\\r\nb'), { raw: 'a\\\r\n', caret: 4 }).text).toBe('a\\\r\n');
	});

	// A widget's own key hands its text over whole, which a plugin may spell without the ending.
	it('takes nothing off an edit that does not end with the block’s ending', () => {
		expect(rangeWrite(paragraph('ab\n'), { raw: 'a', caret: 1 }).text).toBe('a');
	});
});

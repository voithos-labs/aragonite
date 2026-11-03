// The one write a block makes to its own text puts the caret back only where the write left the
// block as it was: a write that changed the kind or merged lands the caret itself, and a second
// restore would fight that landing.
// Miss-analysis: every write site parked a caret on `admitted` alone, and no test stubbed a write
// that reported it had placed the caret, so the field had no reader and nothing noticed.
import { fixtureReading } from '../../harness/fixture-grammar';
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
import { parse } from '#lib/core/parser.js';
import { definitionsOf } from '#lib/core/inline/scan/definitions.js';

const TYPED: Omit<TextWrite, 'text' | 'caretAfter'> = {
	intent: 'typed',
	history: 'join-typing',
	mode: 'authored',
	source: 'input'
};

/** A block holding `raw` whose list answers every write with `keepsCaret`, recording each one. */
function writerOver(raw: string, keepsCaret: boolean, reading = fixtureReading()) {
	const node: NodeView = { kind: 'paragraph', leadingTrivia: '', raw };
	const requestCaret = vi.fn();
	const written: { bytes: string; caret: number }[] = [];
	const blockEdit: BlockEditActions = {
		...stubBlockEdit(),
		updateBlockContent: (_index, text, _mode, _history, _before, after = 0) => {
			written.push({ bytes: text, caret: after });
			return withStoredCaret(Promise.resolve(true), after, undefined, keepsCaret);
		}
	};
	const writeText = createSurfaceWrite({
		reading,
		getNode: () => node,
		getIndex: () => 0,
		getPath: () => [0],
		blockEdit,
		kindCue: { afterTypedWrite: async () => {}, labelAt: () => undefined, dismiss: () => {} },
		getPreEditOffset: () => 0,
		requestCaret,
		holdInsertion: () => createInsertionRecords([]).hold({}, null)
	});
	return { writeText, requestCaret, written };
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

// Miss-analysis: #809, a caret's keystroke inside a reference reaches the text through no range
// edit, and no row typed into a shortcut reference's text.
describe('a caret’s keystroke inside a reference’s text', () => {
	const definitions = (mode: 'live' | 'source') => {
		const { resolve, signature } = definitionsOf(parse('[foo]: https://foo.example\n').children);
		return fixtureReading({ resolver: resolve, resolverSignature: signature }, mode);
	};

	it.each([
		['typed into a shortcut', 'a [foo] b\n', 'a [foZo] b', 6, 'a [foZo][foo] b\n'],
		['typed into a collapsed one', 'a [foo][] b\n', 'a [foZo][] b', 6, 'a [foZo][foo] b\n'],
		['deleted from a shortcut', 'a [foo] b\n', 'a [fo] b', 5, 'a [fo][foo] b\n']
	])('%s keeps its destination', (_, raw, text, caretAfter, bytes) => {
		const { writeText, written } = writerOver(raw, true, definitions('live'));
		void writeText({ ...TYPED, text, caretAfter });
		expect(written).toEqual([{ bytes, caret: caretAfter }]);
	});

	it('writes source mode’s keystroke as typed, since the brackets are on screen', () => {
		const { writeText, written } = writerOver('a [foo] b\n', true, definitions('source'));
		void writeText({ ...TYPED, text: 'a [foZo] b', caretAfter: 6 });
		expect(written[0].bytes).toBe('a [foZo] b\n');
	});
});

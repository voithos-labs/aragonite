// @vitest-environment jsdom
// A same-type list paste inside a list item flattens into the enclosing list, over the paste
// positions and shapes, with ordered markers renumbered across the whole list.
// Miss-analysis: only the unordered marker rows ran below a browser, so the position, numbering and
// marker-style rows reached the absorb path through real pastes in e2e alone.
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { serialize } from '$lib/core/serializer';
import {
	makePasteCommit,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';

interface AbsorbRow {
	name: string;
	doc: string;
	clip: string;
	target: number[];
	offset: number;
	/** The whole list after the paste. */
	after: string;
}

const ROWS: AbsorbRow[] = [
	{
		name: 'ordered paste in the middle of an item splits it and sandwiches the pasted items',
		doc: '1. alphagamma\n2. beta\n',
		clip: '1. x\n2. y\n',
		target: [0, 0, 0],
		offset: 'alpha'.length,
		after: '1. alpha\n2. x\n3. y\n4. gamma\n5. beta\n'
	},
	{
		name: 'ordered paste at the start of an item lands the pasted items before it',
		doc: '1. alpha\n2. beta\n',
		clip: '1. x\n2. y\n',
		target: [0, 0, 0],
		offset: 0,
		after: '1. x\n2. y\n3. alpha\n4. beta\n'
	},
	{
		name: 'ordered paste at the end of a middle item lands between it and the rest',
		doc: '1. a\n2. b\n3. c\n',
		clip: '1. x\n2. y\n',
		target: [0, 1, 0],
		offset: 'b'.length,
		after: '1. a\n2. b\n3. x\n4. y\n5. c\n'
	},
	{
		name: 'unordered paste at the end of an item absorbs as flat siblings',
		doc: '- a\n- b\n',
		clip: '- x\n- y\n',
		target: [0, 0, 0],
		offset: 'a'.length,
		after: '- a\n- x\n- y\n- b\n'
	},
	{
		name: 'ordered paste with a mismatched marker suffix takes the enclosing list style',
		doc: '1. alpha\n2. beta\n',
		clip: '1) x\n2) y\n',
		target: [0, 0, 0],
		offset: 'alpha'.length,
		after: '1. alpha\n2. x\n3. y\n4. beta\n'
	},
	{
		name: 'ordered paste without a trailing newline still absorbs as separate items',
		doc: '1. Ordered first\n2. Ordered second\n3. Ordered third\n',
		clip: '1. first\n2. Ordered second\n3. Ordered',
		target: [0, 2, 0],
		offset: 'Ordered'.length,
		after:
			'1. Ordered first\n2. Ordered second\n3. Ordered\n4. first\n5. Ordered second\n6. Ordered\n7.  third\n'
	},
	{
		name: 'a single pasted item absorbs as one sibling',
		doc: '1. alpha\n2. beta\n',
		clip: '1. only\n',
		target: [0, 0, 0],
		offset: 'alpha'.length,
		after: '1. alpha\n2. only\n3. beta\n'
	},
	{
		name: 'ordered paste into a list that does not start at 1 keeps its start number',
		doc: '3. a\n4. b\n5. c\n',
		clip: '1. x\n2. y\n',
		target: [0, 2, 0],
		offset: 'c'.length,
		after: '3. a\n4. b\n5. c\n6. x\n7. y\n'
	}
];

describe('a same-type list paste flattens into the enclosing list', () => {
	it.each(ROWS)('$name', async ({ doc: source, clip, target, offset, after }) => {
		const { doc, controller } = makePasteCommit(source);
		registerStubBlockListState(doc.children[0]);

		await pasteDispatch(
			{ pastedText: clip, targetPath: target, offset },
			pasteContext({ doc, blockEdit: makeStubBlockEdit(), controller })
		);

		expect(serialize(doc)).toBe(after);
	});
});

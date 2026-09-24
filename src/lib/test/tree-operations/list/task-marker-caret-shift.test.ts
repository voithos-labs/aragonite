import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { taskMarkerCaretShift } from '$lib/tree-operations/list/reconcile-task';

// A task marker typed at the front of an item's paragraph moves into the item, and the caret moves
// back with the text by the marker's length.
// Miss-analysis: the caret restore after a container rewrite knew only the body-write rule, and
// every task test checked the item's bytes, never where the next key landed.

const itemOf = (source: string): CstNode => parse(source).children[0].children![0];

describe('taskMarkerCaretShift', () => {
	it('moves back by the marker a plain item takes off the front', () => {
		expect(taskMarkerCaretShift(itemOf('- abc\n'), '[ ] abc\n')).toBe(-4);
		expect(taskMarkerCaretShift(itemOf('- abc\n'), '[x]  abc\n')).toBe(-5);
	});

	it('stays put while the marker stays where it is', () => {
		expect(taskMarkerCaretShift(itemOf('- [ ] abc\n'), 'abcd\n')).toBe(0);
		expect(taskMarkerCaretShift(itemOf('- abc\n'), '[ ]abc\n')).toBe(0);
	});

	it('reads only the first line', () => {
		expect(taskMarkerCaretShift(itemOf('- abc\n'), 'x\n[ ] y\n')).toBe(0);
	});

	it('stays put outside a list item', () => {
		expect(taskMarkerCaretShift(parse('> abc\n').children[0], '[ ] abc\n')).toBe(0);
	});
});

// G1.42: the tree says what its reload reads about a list item's checkbox. A task item holds a
// paragraph first, and a plain one holds no first paragraph that opens with a checkbox.
import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { checkTaskMarkerSlot } from '$lib/invariants/node-shape';
import { assertCommittedNodes } from '$lib/invariants/install';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { drainDevWarns, takeDevWarns } from '$lib/test/support/warn-gate';

/** A task item whose first block was swapped for a heading, the shape a plain fragment reparse
 *  leaves in a task's slot. */
function taskWithHeading(): CstNode {
	const list = parse('- [ ] a\n').children[0];
	list.children![0].children![0] = parse('# a\n').children[0];
	return list;
}

function plainWithCheckbox(): CstNode {
	const list = parse('- a\n').children[0];
	list.children![0].children![0].raw = '[ ] a\n';
	return list;
}

describe('checkTaskMarkerSlot (G1.42)', () => {
	it('flags a task item whose first block is no paragraph', () => {
		expect(checkTaskMarkerSlot(taskWithHeading())?.code).toBe('task-marker-slot');
	});

	it('flags a plain item whose first paragraph opens with a checkbox', () => {
		expect(checkTaskMarkerSlot(plainWithCheckbox())?.code).toBe('task-marker-slot');
	});

	it('finds the item at any depth', () => {
		const quote = parse('> - a\n').children[0];
		quote.children![0] = taskWithHeading();
		expect(checkTaskMarkerSlot(quote)?.code).toBe('task-marker-slot');
	});

	it.each(['- [ ] # a\n', '- [x] a\n  # b\n', '- a\n', '- \\[ ] a\n', '- # a\n'])(
		'passes the parse of %j',
		(source) => {
			expect(checkTaskMarkerSlot(parse(source).children[0])).toBeNull();
		}
	);
});

describe('the commit runs G1.42 over its touched nodes', () => {
	it('fires on a planted task item holding a heading', () => {
		drainDevWarns();
		assertCommittedNodes([taskWithHeading()], defaultGrammarView);
		expect(takeDevWarns().some((fire) => fire.tag === 'invariant:task-marker-slot')).toBe(true);
	});
});

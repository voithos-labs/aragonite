// G1.42: a list item holds the checkbox and the block kinds its reload reads, so a write that read
// its bytes with the wrong reader is caught, and a shape the parser loads is not.
// Miss-analysis: the first version checked a stand-in (a task item holds a paragraph first), which
// the parser breaks for `- [ ] |b|` over a delimiter row, so it fired on a loadable document.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { CstNode, ListItemMetadata } from '#lib/core/nodes.js';
import { checkTaskMarkerSlot } from '#lib/invariants/node-shape.js';
import { paragraphNode } from '#lib/tree-operations/node-primitives.js';
import { assertCommittedNodes } from '#lib/invariants/install.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { drainDevWarns, takeDevWarns } from '#lib/test/support/warn-gate.js';

const check = (node: CstNode) => checkTaskMarkerSlot(node, defaultGrammarView);

/** `- [ ] a` whose paragraph was swapped for a heading while the bytes still read as a to-do: the
 *  drift a plain read of a task item's first line leaves. */
function taskWithHeading(source = '- [ ] # a\n', item = (doc: CstNode) => doc): CstNode {
	const root = parse(source).children[0];
	const owner = item(root).children![0];
	owner.children![0] = parse('# a\n').children[0];
	return root;
}

/** A plain item whose bytes read as a to-do: the drift a missing reconcile leaves. */
function plainThatReadsAsTask(): CstNode {
	const list = parse('- [ ] a\n').children[0];
	const meta = list.children![0].metadata as ListItemMetadata;
	Object.assign(meta, { taskItem: false, taskMarker: null, taskChecked: false });
	return list;
}

describe('checkTaskMarkerSlot (G1.42)', () => {
	it('flags a task item holding a heading its reload reads as the paragraph', () => {
		expect(check(taskWithHeading())?.code).toBe('task-marker-slot');
	});

	it('flags a plain item whose reload reads a checkbox', () => {
		expect(check(plainThatReadsAsTask())?.code).toBe('task-marker-slot');
	});

	// Miss-analysis: the check compared the first block only and skipped a shape whose child count
	// differed, so a to-do split into two paragraphs its reload reads as one passed it.
	it('flags a to-do holding two paragraphs where its reload reads one', () => {
		const list = parse('- [ ] # x\n  bc\n').children[0];
		const item = list.children![0];
		item.children = [paragraphNode('', '# x', '\n'), paragraphNode('', 'bc', '\n')];
		expect(check(list)?.code).toBe('task-marker-slot');
	});

	// Miss-analysis: the check compared a plain item's checkbox only, so an item built over indented
	// code its marker line reads as a paragraph passed it.
	it('flags a plain item holding indented code its reload reads as a paragraph', () => {
		const list = parse('-     b\n').children[0];
		list.children![0].children = [parse('    b\n').children[0]];
		expect(check(list)?.code).toBe('task-marker-slot');
	});

	it('leaves an item holding no block to the empty-container check', () => {
		const list = parse('- a\n').children[0];
		list.children![0].children = [];
		expect(check(list)).toBeNull();
	});

	it('finds the item at any depth', () => {
		const quote = taskWithHeading('> - [ ] # a\n', (q) => q.children![0]);
		expect(check(quote)?.code).toBe('task-marker-slot');
	});

	it.each([
		'- [ ] # a\n',
		'- [x] a\n  # b\n',
		'- a\n',
		'- \\[ ] a\n',
		'- # a\n',
		'- [ ] |b|\n  |-|\n',
		'> - [ ] |b|\n>   |-|\n'
	])('passes the parse of %j, whose tree is its reload', (source) => {
		expect(check(parse(source).children[0])).toBeNull();
	});
});

describe('the commit runs G1.42 over its touched nodes', () => {
	it('fires on a planted task item holding a heading', () => {
		drainDevWarns();
		assertCommittedNodes([taskWithHeading()], defaultGrammarView);
		expect(takeDevWarns().some((fire) => fire.tag === 'invariant:task-marker-slot')).toBe(true);
	});
});

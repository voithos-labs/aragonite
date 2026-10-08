import { describe, expect, it } from 'vitest';
import {
	firstChildUnwrapStrategies,
	middleChildUnwrapStrategies
} from '#lib/editor-actions/unwrap-strategies.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { ALL_BLOCK_KINDS } from '#lib/core/nodes.js';
import { serialize } from '#lib/core/serializer.js';
import { makeNestedHarness } from '#lib/test/harness/editor-actions.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

describe('unwrapRole declarations resolve to registered strategies', () => {
	it('every declared role names an implemented strategy', () => {
		for (const kind of ALL_BLOCK_KINDS) {
			const role = tryGetBlockKindDescriptor(kind)?.unwrapRole;
			if (!role) continue;
			expect(firstChildUnwrapStrategies[role.firstChildBackspace]).toBeTypeOf('function');
			if (role.middleChildBackspace !== 'default-merge') {
				expect(middleChildUnwrapStrategies[role.middleChildBackspace]).toBeTypeOf('function');
			}
		}
	});

	it('blockquote and list declare the built-in wiring; listItem stays undeclared (delegates up)', () => {
		expect(tryGetBlockKindDescriptor('blockquote')?.unwrapRole).toEqual({
			firstChildBackspace: 'lift-first-child-drop-opener',
			middleChildBackspace: 'default-merge'
		});
		expect(tryGetBlockKindDescriptor('list')?.unwrapRole).toEqual({
			firstChildBackspace: 'list-item-cascade',
			middleChildBackspace: 'list-item-cascade'
		});
		expect(tryGetBlockKindDescriptor('listItem')?.unwrapRole).toBeUndefined();
	});
});

// Miss-analysis: the middle-item Backspace was tested only below paragraph items.
describe('Backspace at the start of an item under a heading item', () => {
	it.each([
		['an ATX heading item', '- # Plan\n- next\n', '- # Plannext\n'],
		['a setext heading item', '- Plan\n  ===\n- next\n', '- Plannext\n  ===\n']
	])('joins the item into %s as one undo step', async (_name, before, after) => {
		const h = makeNestedHarness(before, { index: 0, presentationMode: 'live' });

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(serialize(h.deps.doc)).toBe(after);
		expect(h.deps.undoManager.getStacks().undo).toHaveLength(1);
		expect(takeDevWarns()).toEqual([]);
	});
});

// Miss-analysis: the middle-item Backspace was only tested where it joins, never where it refuses.
describe('Backspace at the start of an item with nothing to join', () => {
	it.each([
		['a join that reads as two blocks', '- # h\n- text\n  more\n'],
		['an item that does not open with a paragraph', '- a\n- # h\n']
	])('%s changes nothing and records no undo step', async (_name, before) => {
		const h = makeNestedHarness(before, { index: 0, presentationMode: 'live' });

		await h.bundle.blockEdit.mergeWithPrevious(1);

		expect(serialize(h.deps.doc)).toBe(before);
		expect(h.deps.undoManager.getStacks().undo).toHaveLength(0);
		expect(takeDevWarns()).toEqual([]);
	});
});

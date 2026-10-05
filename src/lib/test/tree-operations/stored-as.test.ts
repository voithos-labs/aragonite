// @vitest-environment jsdom
// Where a leaf's bytes are stored: the kind and container write rules, and the slot reading a
// reload gives them, a list item's marker line included.
import { describe, expect, it } from 'vitest';
import { parse } from '$lib/core/parser';
import type { CstNode } from '$lib/core/nodes';
import { nodeAt } from '$lib/tree-operations/node-primitives';
import { storedAsAt, storedAsIn } from '$lib/tree-operations/stored-as';
import { readThroughItemMarker } from '$lib/tree-operations/list/task-paragraph';
import { fixtureGrammar, fixtureReading } from '../harness/fixture-grammar';

const storeAt = (source: string, path: number[]) =>
	storedAsAt(parse(source), path, fixtureReading());

const kinds = (doc: { children: readonly CstNode[] } | null) =>
	doc?.children.map((c) => [c.kind, c.raw]) ?? null;

describe('what a position stores', () => {
	it('a table cell stores text, a paragraph a block', () => {
		expect(storeAt('| h |\n| - |\n| a |\n', [0, 1, 0]).surface).toBe('inline');
		expect(storeAt('a\n', [0]).surface).toBe('block');
		expect(storeAt('- a\n', [0, 0, 0]).surface).toBe('block');
	});

	it('the bytes pass the kind’s write rule: a cell escapes its pipes', () => {
		expect(storeAt('| h |\n| - |\n| a |\n', [0, 1, 0]).stored('a|b')).toBe('a\\|b');
	});

	it('a top-level or quoted slot reads its bytes as a fragment', () => {
		expect(kinds(storeAt('a\n', [0]).readSlot(' b\n'))).toEqual([['paragraph', ' b\n']]);
		expect(kinds(storeAt('> a\n', [0, 0]).readSlot('# b\n'))).toEqual([['heading', '# b\n']]);
	});

	// A split's second half lands in a slot no block holds yet, past the holder's last child.
	it('a slot past the last child stores and reads a new block there', () => {
		const store = storedAsIn(parse('a\n'), 1, fixtureReading());
		expect(store.surface).toBe('block');
		expect(store.stored('**b**\n')).toBe('**b**\n');
		expect(kinds(store.readSlot('# b\n'))).toEqual([['heading', '# b\n']]);
	});

	it('a list item’s first slot reads through its marker; a later slot as a fragment', () => {
		const source = '- a\n\n  b\n';
		expect(kinds(storeAt(source, [0, 0, 0]).readSlot('# c\n'))).toEqual([['heading', '# c\n']]);
		expect(kinds(storeAt(source, [0, 0, 1]).readSlot('- c\n'))?.[0][0]).toBe('list');
	});
});

describe('reading bytes through a list item’s marker', () => {
	const itemOf = (source: string) => nodeAt(parse(source), [0, 0]) as CstNode;
	const read = (source: string, text: string) =>
		kinds(readThroughItemMarker(itemOf(source), text, fixtureGrammar));

	// GFM reads a task item's first line as paragraph text, whatever it would open elsewhere.
	it('`# b` stays a paragraph behind a task marker and is a heading behind a plain one', () => {
		expect(read('- [ ] a\n', '# b\n')).toEqual([['paragraph', '# b\n']]);
		expect(read('- a\n', '# b\n')).toEqual([['heading', '# b\n']]);
	});

	// The reload widens the marker over the space, so the block holds the text without it.
	it('a leading space is taken into the marker, and the item is still one item', () => {
		expect(read('- a\n', ' x\n')).toEqual([['paragraph', 'x\n']]);
		expect(read('- [ ] a\n', ' x\n')).toEqual([['paragraph', 'x\n']]);
		expect(read('1. a\n', ' x\n')).toEqual([['paragraph', 'x\n']]);
	});

	it('a continuation line sits in the content column, as the item writes it', () => {
		expect(read('- a\n', 'x\n- y\n')).toEqual([
			['paragraph', 'x\n'],
			['list', '- y\n']
		]);
	});

	it('refuses bytes that change the item’s task state', () => {
		expect(read('- a\n', '[ ] x\n')).toBeNull();
	});
});

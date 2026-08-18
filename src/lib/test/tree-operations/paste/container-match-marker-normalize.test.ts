// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { parse } from '../../../core/parser';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState
} from '../../harness/editor-actions';
import { metadataOf } from '../../../core/nodes';

// Splicing pasted list items into a matching ancestor without templating their bullet
// glyph leaves a `*` inside a `- ` list, which reference parsers split into two lists.
// Mirrors the list-absorb unordered-marker fix.

describe('container-matching paste — unordered marker normalization', () => {
	it('templates pasted "*" markers to the enclosing "-" list on the empty-target route', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubBlockListState(list);

		await pasteDispatch(
			{ pastedText: '* x\n* y', targetPath: [0, 0, 0], offset: 0 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'- ',
			'- ',
			'- '
		]);
		expect(list.raw).toBe('- x\n- y\n- keep\n');
	});

	it('templates pasted "*" markers to the enclosing "-" list on the non-empty merge route', async () => {
		const doc = parse('- alpha\n- keep\n');
		const list = doc.children[0];
		registerStubBlockListState(list);

		// A cross-block 'join' paste takes the merge-first branch, splicing the trailing pasted
		// item as a sibling.
		await pasteDispatch(
			{ pastedText: '* x\n* y\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'- ',
			'- ',
			'- '
		]);
		expect(list.raw).toBe('- alphax\n- y\n- keep\n');
	});
});

// Ordered items spliced with their pasted numbers intact leave the source misnumbered,
// which reference renderers mask by re-sequencing. Mirrors the sibling-absorb renumber.
describe('container-matching paste — ordered renumbering', () => {
	it('renumbers pasted ordered items into the sequence on the empty-target route', async () => {
		const doc = parse('1. a\n2. keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubBlockListState(list);

		await pasteDispatch(
			{ pastedText: '1. x\n2. y', targetPath: [0, 0, 0], offset: 0 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'1. ',
			'2. ',
			'3. '
		]);
		expect(list.raw).toBe('1. x\n2. y\n3. keep\n');
	});

	it('renumbers the spliced siblings and tail on the non-empty merge route', async () => {
		const doc = parse('1. alpha\n2. keep\n');
		const list = doc.children[0];
		registerStubBlockListState(list);

		// A cross-block 'join' paste takes the merge-first branch, splicing the trailing pasted
		// item as a sibling.
		await pasteDispatch(
			{ pastedText: '1. x\n2. y\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'1. ',
			'2. ',
			'3. '
		]);
		expect(list.raw).toBe('1. alphax\n2. y\n3. keep\n');
	});
});

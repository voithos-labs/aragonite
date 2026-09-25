// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import {
	makePasteCommit,
	makeStubBlockEdit,
	registerStubBlockListState,
	pasteContext
} from '../../harness/editor-actions';
import { metadataOf } from '../../../core/nodes';

// Splicing pasted list items into a matching ancestor without templating their bullet glyph
// leaves a `*` inside a `- ` list, which reference parsers split into two lists; ordered items
// spliced with their pasted numbers intact leave the source misnumbered, which reference
// renderers mask by re-sequencing. Mirrors the list-absorb normalization and renumber.

describe('container-matching paste: marker normalization, both routes', () => {
	// An emptied first item stands in for a post-cross-block-delete stub (the empty-target
	// route); a non-empty target takes the merge-first branch, splicing the trailing pasted
	// item as a sibling.
	it.each([
		{
			name: 'unordered, empty-target route templates "*" to the enclosing "-"',
			source: '- a\n- keep\n',
			pastedText: '* x\n* y',
			offset: 0,
			emptyTarget: true,
			markers: ['- ', '- ', '- '],
			raw: '- x\n- y\n- keep\n'
		},
		{
			name: 'unordered, non-empty merge route templates "*" to the enclosing "-"',
			source: '- alpha\n- keep\n',
			pastedText: '* x\n* y\n',
			offset: 'alpha'.length,
			emptyTarget: false,
			markers: ['- ', '- ', '- '],
			raw: '- alphax\n- y\n- keep\n'
		},
		{
			name: 'ordered, empty-target route renumbers into the sequence',
			source: '1. a\n2. keep\n',
			pastedText: '1. x\n2. y',
			offset: 0,
			emptyTarget: true,
			markers: ['1. ', '2. ', '3. '],
			raw: '1. x\n2. y\n3. keep\n'
		},
		{
			name: 'ordered, non-empty merge route renumbers the spliced siblings and tail',
			source: '1. alpha\n2. keep\n',
			pastedText: '1. x\n2. y\n',
			offset: 'alpha'.length,
			emptyTarget: false,
			markers: ['1. ', '2. ', '3. '],
			raw: '1. alphax\n2. y\n3. keep\n'
		}
	])('$name', async ({ source, pastedText, offset, emptyTarget, markers, raw }) => {
		const { doc, controller } = makePasteCommit(source);
		if (emptyTarget) doc.children[0].children![0].children![0].raw = '';
		registerStubBlockListState(doc.children[0]);

		await pasteDispatch(
			{ pastedText, targetPath: [0, 0, 0], offset },
			pasteContext({
				doc,
				blockEdit: makeStubBlockEdit(),
				controller,
				undoEntry: 'join'
			})
		);

		const list = doc.children[0];
		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual(markers);
		expect(list.raw).toBe(raw);
	});
});

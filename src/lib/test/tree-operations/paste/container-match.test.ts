// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { findContainerMatchingUnwrap } from '../../../tree-operations/paste/container-match';
import { parse } from '../../../core/parser';
import {
	makeRunningPasteController,
	makeStubBlockEdit,
	registerStubBlockListState
} from '../../harness/editor-actions';

describe('container-matching paste — empty-target newline-termination (A1)', () => {
	it('pasting a list without a trailing newline into a non-last empty item keeps the following sibling separate', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubBlockListState(list);

		await pasteDispatch(
			{ pastedText: '- x\n- y', targetPath: [0, 0, 0], offset: 0 },
			{
				doc,
				blockEdit: makeStubBlockEdit(),
				controller: makeRunningPasteController(),
				undoEntry: 'join'
			}
		);

		// An un-terminated last pasted item mashes into the following sibling on one line.
		expect(list.raw).toBe('- x\n- y\n- keep\n');
	});
});

describe('findContainerMatchingUnwrap — blockquote non-empty target (no wholesale replace)', () => {
	it('returns null for a single-blockquote clipboard pasted into a non-empty blockquote paragraph', () => {
		const doc = parse('> hello\n');
		const blockquote = doc.children[0];
		expect(blockquote.kind).toBe('blockquote');
		expect(blockquote.children![0].kind).toBe('paragraph');

		const clipboard = parse('> world\n');

		const unwrap = findContainerMatchingUnwrap(doc, [0, 0], 'hello'.length, clipboard, false);

		// A non-empty paragraph must not classify as an empty stub, and crossBlockContext=false
		// keeps the merge-first branch from firing, so the router defers to structural paste.
		expect(unwrap).toBeNull();
	});

	it('still unwraps when the blockquote paragraph is genuinely empty', () => {
		const doc = parse('> hello\n');
		const blockquote = doc.children[0];
		blockquote.children![0].raw = '';

		const clipboard = parse('> world\n');
		const unwrap = findContainerMatchingUnwrap(doc, [0, 0], 0, clipboard, false);

		expect(unwrap).not.toBeNull();
		expect(unwrap!.merge).toBeUndefined();
		expect(unwrap!.outerPath).toEqual([0]);
	});
});

// The merge slices a DISPLAY offset out of the target leaf and reattaches the residue to the
// clipboard's last item, so both ends must be one paragraph. An item carrying more declines the
// whole unwrap and the paste falls through to the routes that splice whole blocks.
// Miss-analysis: the finder's paragraph gate had pins for empty and non-empty TARGETS but none
// for a clipboard item whose shape the merge cannot address.
describe('findContainerMatchingUnwrap — the merge arm’s paragraph gate', () => {
	const target = () => parse('- hello\n');

	it('unwraps with a merge when every clipboard item is one paragraph', () => {
		const unwrap = findContainerMatchingUnwrap(
			target(),
			[0, 0, 0],
			'hello'.length,
			parse('- one\n- two\n'),
			true
		);

		expect(unwrap!.merge).toEqual({
			targetLeafPath: [0, 0, 0],
			offset: 'hello'.length,
			targetRaw: 'hello\n'
		});
	});

	it('declines when the first item carries more than its paragraph', () => {
		const clipboard = parse('- one\n\n  two\n- three\n');
		expect(clipboard.children[0].children![0].children).toHaveLength(2);

		expect(
			findContainerMatchingUnwrap(target(), [0, 0, 0], 'hello'.length, clipboard, true)
		).toBeNull();
	});

	it('declines when the last item carries more than its paragraph', () => {
		const clipboard = parse('- one\n- two\n\n  three\n');
		expect(clipboard.children[0].children![1].children).toHaveLength(2);

		expect(
			findContainerMatchingUnwrap(target(), [0, 0, 0], 'hello'.length, clipboard, true)
		).toBeNull();
	});
});

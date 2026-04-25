import { describe, it, expect, vi } from 'vitest';
import { createStandardNestedActions } from '../../editor-actions/nested-actions';
import { createBlockListState } from '../../reactivity/block-list-state.svelte';
import type { CstNode } from '../../core/nodes';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from '../harness/editor-actions';

function makeNode(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		children,
		innerPrefix: '',
		innerSuffix: ''
	};
}

function makePara(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function fakeParentBundles() {
	return {
		blockEdit: makeStubBlockEdit(),
		focus: makeStubFocus(),
		containerEdit: makeStubContainerEdit()
	};
}

describe('createStandardNestedActions', () => {
	it('focus.moveFocus delegates upward when innerIndex is out of range', async () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 7,
			get node() {
				return node;
			},
			rebuildRaw: vi.fn(),
			stickyColumn: makeStickyColumn(),
			parent
		});

		await bundle.focus.moveFocus(-1, 'end');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(6, 'end');

		await bundle.focus.moveFocus(10, 'start');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(8, 'start');
	});

	it('blockEdit.mergeWithPrevious delegates upward at innerIndex=0', async () => {
		const node = makeNode([makePara('a\n'), makePara('b\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 3,
			get node() {
				return node;
			},
			rebuildRaw: vi.fn(),
			stickyColumn: makeStickyColumn(),
			parent
		});

		await bundle.blockEdit.mergeWithPrevious(0);

		expect(parent.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(3);
	});

	it('blockEdit.deleteBlock on last remaining child delegates upward', async () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 3,
			get node() {
				return node;
			},
			rebuildRaw: vi.fn(),
			stickyColumn: makeStickyColumn(),
			parent
		});

		await bundle.blockEdit.deleteBlock(0);

		expect(parent.blockEdit.deleteBlock).toHaveBeenCalledWith(3);
	});
});

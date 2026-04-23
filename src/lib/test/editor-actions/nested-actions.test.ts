import { describe, it, expect, vi } from 'vitest';
import { createStandardNestedActions } from '../../editor-actions/nested-actions';
import { createBlockListState } from '../../block-list-state.svelte';
import type { CstNode } from '../../core/nodes';
import type { BlockEditActions, FocusActions, ContainerEditActions } from '../../contracts';
import type { StickyColumnState } from '../../contenteditable/sticky-column';

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

function fakeStickyColumn(x: number | null = null): StickyColumnState {
	return { get: () => x, capture: vi.fn(), reset: vi.fn() };
}

function fakeParentBundles() {
	const blockEdit: BlockEditActions = {
		splitBlock: vi.fn(),
		mergeWithPrevious: vi.fn(),
		mergeWithNext: vi.fn(),
		deleteBlock: vi.fn(),
		updateBlockContent: vi.fn(),
		updateBlockMetadata: vi.fn(),
		insertParsedBlocks: vi.fn(),
		replaceBlock: vi.fn()
	};
	const focus: FocusActions = { moveFocus: vi.fn() };
	const containerEdit: ContainerEditActions = {
		pushCheckpoint: vi.fn(),
		pushDebouncedCheckpoint: vi.fn(),
		nudgeReactivity: vi.fn(),
		commitContainer: vi.fn()
	};
	return { blockEdit, focus, containerEdit };
}

describe('createStandardNestedActions', () => {
	it('returns a bundle with blockEdit, focus, containerEdit (no history)', () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 0,
			get node() {
				return node;
			},
			rebuildRaw: vi.fn(),
			stickyColumn: fakeStickyColumn(),
			parent
		});

		expect(bundle.blockEdit).toBeDefined();
		expect(bundle.focus).toBeDefined();
		expect(bundle.containerEdit).toBeDefined();
		expect('history' in bundle).toBe(false);
	});

	it('containerEdit.pushCheckpoint translates inner index to container index', () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 5,
			get node() {
				return node;
			},
			rebuildRaw: vi.fn(),
			stickyColumn: fakeStickyColumn(),
			parent
		});

		bundle.containerEdit.pushCheckpoint(0, 3);

		expect(parent.containerEdit.pushCheckpoint).toHaveBeenCalledWith(5, 3);
	});

	it('containerEdit.nudgeReactivity calls rebuildRaw and forwards to parent', () => {
		const rebuildRaw = vi.fn();
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			index: 0,
			get node() {
				return node;
			},
			rebuildRaw,
			stickyColumn: fakeStickyColumn(),
			parent
		});

		bundle.containerEdit.nudgeReactivity();

		expect(rebuildRaw).toHaveBeenCalledOnce();
		expect(parent.containerEdit.nudgeReactivity).toHaveBeenCalledOnce();
	});

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
			stickyColumn: fakeStickyColumn(),
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
			stickyColumn: fakeStickyColumn(),
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
			stickyColumn: fakeStickyColumn(),
			parent
		});

		await bundle.blockEdit.deleteBlock(0);

		expect(parent.blockEdit.deleteBlock).toHaveBeenCalledWith(3);
	});
});

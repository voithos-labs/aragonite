// @vitest-environment jsdom
//
// `createNestedBlockEdit`'s own contribution over the shared block-edit core is entirely
// BOUNDARY logic: which calls stay inside the container and which hand UP to the parent.
// An edge merge that stayed interior dead-ends silently; an interior merge that delegated
// deletes the wrong block. Each case pins one side plus its interior twin.
import { describe, it, expect, vi } from 'vitest';
import { setPluginMetadata, type CstNode } from '$lib/core/nodes';
import { createNestedBlockEdit } from '$lib/editor-actions/nested/nested-block-edit';
import type { NestedActionsDeps } from '$lib/editor-actions/nested/nested-actions';
import { registerDetailsKind, DETAILS } from '$lib/plugins/details/details-kind';
import {
	makeBlockListState,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from '../../harness/editor-actions';

registerDetailsKind();

const CONTAINER_INDEX = 3;

function paragraph(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw } as CstNode;
}

function env(node: CstNode) {
	const parent = {
		blockEdit: makeStubBlockEdit(),
		focus: makeStubFocus(),
		containerEdit: makeStubContainerEdit()
	};
	const state = makeBlockListState(() => node);
	const deps = {
		index: CONTAINER_INDEX,
		node,
		path: [CONTAINER_INDEX],
		stickyColumn: makeStickyColumn(),
		parent
	} as unknown as NestedActionsDeps;
	return { blockEdit: createNestedBlockEdit(state, deps), parent, node };
}

function container(kind: string, childCount: number): CstNode {
	return {
		kind,
		leadingTrivia: '',
		raw: '',
		children: Array.from({ length: childCount }, (_, i) => paragraph(`p${i}\n`))
	} as CstNode;
}

function collapsedDetails(childCount: number): CstNode {
	const node = container(DETAILS, childCount);
	setPluginMetadata(node, { open: false });
	return node;
}

describe('nested block edit — upward boundaries', () => {
	it('delegates a first-child merge upward for a container declaring no unwrapRole', async () => {
		const { blockEdit, parent } = env(container('listItem', 2));

		await blockEdit.mergeWithPrevious(0);

		expect(parent.blockEdit.mergeWithPrevious).toHaveBeenCalledWith(CONTAINER_INDEX);
	});

	it('keeps an interior merge inside the container', async () => {
		const { blockEdit, parent, node } = env(container('listItem', 2));

		await blockEdit.mergeWithPrevious(1);

		expect(parent.blockEdit.mergeWithPrevious).not.toHaveBeenCalled();
		expect(node.children).toHaveLength(2);
	});

	it('delegates a last-child forward-merge upward', async () => {
		const { blockEdit, parent } = env(container('listItem', 3));

		await blockEdit.mergeWithNext(2);

		expect(parent.blockEdit.mergeWithNext).toHaveBeenCalledWith(CONTAINER_INDEX);
	});

	it('delegates a delete upward only when it would empty the container', async () => {
		const sole = env(container('listItem', 1));
		await sole.blockEdit.deleteBlock(0);
		expect(sole.parent.blockEdit.deleteBlock).toHaveBeenCalledWith(CONTAINER_INDEX);

		const pair = env(container('listItem', 2));
		await pair.blockEdit.deleteBlock(0);
		expect(pair.parent.blockEdit.deleteBlock).not.toHaveBeenCalled();
	});
});

describe('nested block edit — collapsed forward-merge', () => {
	// The chrome row is the last VISIBLE child while collapsed. `append: false` is
	// load-bearing: without it, exiting past the final block mints a trailing paragraph.
	it('moves focus past the container instead of merging into the hidden body', async () => {
		const { blockEdit, parent, node } = env(collapsedDetails(3));

		await blockEdit.mergeWithNext(0);

		expect(parent.focus.moveFocus).toHaveBeenCalledWith(CONTAINER_INDEX + 1, 'start', {
			append: false
		});
		expect(node.children).toHaveLength(3);
	});

	it('merges interior children normally once the container is open', async () => {
		const node = container(DETAILS, 3);
		setPluginMetadata(node, { open: true });
		const { blockEdit, parent } = env(node);

		await blockEdit.mergeWithNext(0);

		expect(parent.focus.moveFocus).not.toHaveBeenCalled();
	});
});

describe('nested block edit — childless guards', () => {
	// The contrapositive of `if (!deps.node.children) return` is what matters: it returns
	// WITHOUT delegating, so a childless container never asks its parent to act for it.
	it('return without delegating upward when the container has no children', async () => {
		const { blockEdit, parent } = env({ kind: 'listItem', leadingTrivia: '', raw: '' } as CstNode);

		await blockEdit.splitBlock(0, 0);
		await blockEdit.mergeWithPrevious(0);
		await blockEdit.mergeWithNext(0);
		await blockEdit.deleteBlock(0);
		await blockEdit.updateBlockContent(0, 'text\n');

		expect(vi.mocked(parent.blockEdit.mergeWithPrevious)).not.toHaveBeenCalled();
		expect(vi.mocked(parent.blockEdit.mergeWithNext)).not.toHaveBeenCalled();
		expect(vi.mocked(parent.blockEdit.deleteBlock)).not.toHaveBeenCalled();
		expect(vi.mocked(parent.containerEdit.commitContainer)).not.toHaveBeenCalled();
	});
});

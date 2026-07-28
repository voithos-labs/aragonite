import { describe, it, expect, vi } from 'vitest';
import { createStandardNestedActions } from '../../../editor-actions/nested/nested-actions';
import { createBlockListState } from '../../../reactivity/block-list-state.svelte';
import type { CstNode } from '../../../core/nodes';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from '../../harness/editor-actions';

// listItem: the container WITHOUT an unwrapRole — kinds that declare one
// (blockquote/list) dispatch mergeWithPrevious(0) to an unwrap strategy
// instead of delegating upward.
function makeNode(children: CstNode[]): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
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

function makeDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

function makeParentDeferring(method: 'mergeWithPrevious' | 'mergeWithNext' | 'deleteBlock') {
	const deferred = makeDeferred();
	const parent = fakeParentBundles();
	parent.blockEdit[method] = vi.fn(() => deferred.promise);
	return { deferred, parent };
}

// Each method's upward-delegation boundary: the inner index that triggers it
// and the single-child node shape (mergeWithNext/deleteBlock need the inner
// block to be the last/only child; mergeWithPrevious triggers at index 0).
const delegationCases = [
	{
		method: 'mergeWithPrevious' as const,
		children: () => [makePara('a\n'), makePara('b\n')],
		innerIndex: 0
	},
	{ method: 'mergeWithNext' as const, children: () => [makePara('a\n')], innerIndex: 0 },
	{ method: 'deleteBlock' as const, children: () => [makePara('a\n')], innerIndex: 0 }
];

describe('createStandardNestedActions', () => {
	it('focus.moveFocus delegates upward when innerIndex is out of range', async () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(state, {
			scope: {
				index: 7,
				get node() {
					return node;
				},
				path: [7]
			},
			stickyColumn: makeStickyColumn(),
			parent
		});

		await bundle.focus.moveFocus(-1, 'end');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(6, 'end');

		await bundle.focus.moveFocus(10, 'start');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(8, 'start');
	});

	describe('upward delegation awaits the parent before resolving', () => {
		for (const { method, children, innerIndex } of delegationCases) {
			it(`${method} resolves only after the parent's delegated op settles`, async () => {
				const node = makeNode(children());
				const state = createBlockListState(() => node);
				const { deferred, parent } = makeParentDeferring(method);

				const bundle = createStandardNestedActions(state, {
					scope: {
						index: 3,
						get node() {
							return node;
						},
						path: [3]
					},
					stickyColumn: makeStickyColumn(),
					parent
				});

				let continuationRan = false;
				const pending = Promise.resolve(bundle.blockEdit[method](innerIndex)).then(() => {
					continuationRan = true;
				});

				// Drain microtasks: the method's body has run, but the parent's
				// promise is still pending — the continuation must not have fired.
				await Promise.resolve();
				expect(continuationRan).toBe(false);
				expect(parent.blockEdit[method]).toHaveBeenCalledWith(3);

				deferred.resolve();
				await pending;
				expect(continuationRan).toBe(true);
			});
		}
	});
});

import { describe, it, expect } from 'vitest';
import { createStandardNestedActions } from '#lib/editor-actions/nested/nested-actions.js';
import { createBlockListState } from '#lib/block-lists/block-list-state.svelte.js';
import type { CstNode } from '#lib/core/nodes.js';
import type { BlockEditActions } from '#lib/action-contracts.js';
import {
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from '#lib/test/harness/editor-actions.js';

// listItem is the container without an unwrapRole: kinds that declare one send
// mergeWithPrevious(0) to an unwrap strategy instead of handing it to the parent.
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
	const promise = new Promise<boolean>((r) => {
		resolve = () => r(true);
	});
	return { promise, resolve };
}

function makeParentDeferring(method: 'mergeWithPrevious' | 'mergeWithNext' | 'deleteBlock') {
	const deferred = makeDeferred();
	const parent = fakeParentBundles();
	parent.blockEdit[method].mockReturnValue(deferred.promise);
	return { deferred, parent };
}

// Where each method hands up to the parent (the last or only child, or index 0), and the
// arguments the parent receives beside the container's index.
const delegationCases = [
	{
		method: 'mergeWithPrevious' as const,
		children: () => [makePara('a\n'), makePara('b\n')],
		run: (b: BlockEditActions) => b.mergeWithPrevious(0),
		side: []
	},
	{
		method: 'mergeWithNext' as const,
		children: () => [makePara('a\n')],
		run: (b: BlockEditActions) => b.mergeWithNext(0),
		side: []
	},
	{
		method: 'deleteBlock' as const,
		children: () => [makePara('a\n')],
		run: (b: BlockEditActions) => b.deleteBlock(0, 'Delete'),
		side: ['Delete']
	}
];

describe('createStandardNestedActions', () => {
	it('focus.moveFocus delegates upward when innerIndex is out of range', async () => {
		const node = makeNode([makePara('a\n')]);
		const state = createBlockListState(() => node);
		const parent = fakeParentBundles();

		const bundle = createStandardNestedActions(
			state,
			makeNestedActionsDeps({ index: 7, getNode: () => node, path: [7], parent })
		);

		await bundle.focus.moveFocus(-1, 'end');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(6, 'end');

		await bundle.focus.moveFocus(10, 'start');
		expect(parent.focus.moveFocus).toHaveBeenCalledWith(8, 'start');
	});

	describe('upward delegation awaits the parent before resolving', () => {
		for (const { method, children, run, side } of delegationCases) {
			it(`${method} resolves only after the parent's delegated op settles`, async () => {
				const node = makeNode(children());
				const state = createBlockListState(() => node);
				const { deferred, parent } = makeParentDeferring(method);

				const bundle = createStandardNestedActions(
					state,
					makeNestedActionsDeps({ index: 3, getNode: () => node, path: [3], parent })
				);

				let continuationRan = false;
				const pending = run(bundle.blockEdit).then(() => {
					continuationRan = true;
				});

				// One microtask drain: the body has run but the parent's promise is still pending.
				await Promise.resolve();
				expect(continuationRan).toBe(false);
				expect(parent.blockEdit[method]).toHaveBeenCalledWith(3, ...side);

				deferred.resolve();
				await pending;
				expect(continuationRan).toBe(true);
			});
		}
	});
});

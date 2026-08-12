import { describe, it, expect, afterEach } from 'vitest';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { rangeSelectionOf } from '$lib/test/support/undo-entry';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeNestedActionsDeps,
	makeNestedHarness,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';
import { expectDevWarns } from '$lib/test/support/warn-gate';

// The container fixture is hand-built, not parser output, so the container-raw oracle reads it as
// stale.
afterEach(() => expectDevWarns(['invariant:stale-raw']));

// jsdom has no native selection, so every commit here exercises the no-caret fallback:
// the stored path must resolve to the operated child in the snapshot it restores
// (reorder-action's "deep restore path" contract, extended to every container commit).

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

function quoteOf(children: CstNode[]): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: children.map((c) => `> ${c.raw}`).join(''),
		metadata: { quoteDepth: 1 },
		children,
		innerPrefix: '> ',
		innerSuffix: ''
	};
}

function listOf(itemRaws: string[]): CstNode {
	return {
		kind: 'list',
		leadingTrivia: '',
		raw: itemRaws.map((r) => `- ${r}`).join(''),
		metadata: { ordered: false },
		children: itemRaws.map((r) => ({
			kind: 'listItem',
			leadingTrivia: '',
			raw: `- ${r}`,
			metadata: { marker: '- ', taskItem: false, taskChecked: false, taskMarker: null },
			innerPrefix: '',
			innerSuffix: '',
			children: [para(r)]
		})),
		innerPrefix: '',
		innerSuffix: ''
	};
}

function lastUndoEntry(deps: ReturnType<typeof makeEditorActionsDeps>['deps']) {
	const entry = deps.undoManager.getStacks().undo.at(-1);
	expect(entry).toBeDefined();
	return entry!;
}

describe('no-caret container commits snapshot a resolving deep restore path', () => {
	it('container metadata update stores the operated child path', async () => {
		const { deps } = makeEditorActionsDeps([para('pad\n'), quoteOf([para('hello\n')])]);
		const controller = createUndoController(deps);
		const bundle = createStandardNestedActions(
			createBlockListState(() => deps.doc.children[1]),
			makeNestedActionsDeps({
				index: 1,
				getNode: () => deps.doc.children[1],
				path: [1],
				parent: {
					blockEdit: makeStubBlockEdit(),
					focus: makeStubFocus(),
					containerEdit: createContainerEditActions(deps, controller)
				}
			})
		);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		const entry = lastUndoEntry(deps);
		expect(rangeSelectionOf(entry).focus.path).toEqual([1, 0]);
		expect(nodeAt(entry.snapshot, rangeSelectionOf(entry).focus.path)).toBeTruthy();
	});

	it('container delete stores the deleted item path', async () => {
		// The list item delete falls through to the shared core, which still seeds the deep path.
		const h = makeNestedHarness([listOf(['one\n', 'two\n'])], { listOverrides: true, index: 0 });

		await h.bundle.blockEdit.deleteBlock(1);

		const entry = lastUndoEntry(h.deps);
		expect(rangeSelectionOf(entry).focus.path).toEqual([0, 1]);
		expect(nodeAt(entry.snapshot, rangeSelectionOf(entry).focus.path)).toBeTruthy();
	});

	it('a 2-deep nested metadata update stores the leaf path', async () => {
		const { deps } = makeEditorActionsDeps([para('pad\n'), quoteOf([listOf(['one\n'])])]);
		const controller = createUndoController(deps);
		const rootContainerEdit = createContainerEditActions(deps, controller);
		const liveQuote = () => deps.doc.children[1];
		const liveList = () => liveQuote().children![0];

		const quoteBundle = createStandardNestedActions(
			createBlockListState(liveQuote),
			makeNestedActionsDeps({
				index: 1,
				getNode: liveQuote,
				path: [1],
				parent: {
					blockEdit: makeStubBlockEdit(),
					focus: makeStubFocus(),
					containerEdit: rootContainerEdit
				}
			})
		);
		const listBundle = createStandardNestedActions(
			createBlockListState(liveList),
			makeNestedActionsDeps({ index: 0, getNode: liveList, path: [1, 0], parent: quoteBundle })
		);

		await listBundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		const entry = lastUndoEntry(deps);
		expect(rangeSelectionOf(entry).focus.path).toEqual([1, 0, 0]);
		expect(nodeAt(entry.snapshot, rangeSelectionOf(entry).focus.path)).toBeTruthy();
	});
});

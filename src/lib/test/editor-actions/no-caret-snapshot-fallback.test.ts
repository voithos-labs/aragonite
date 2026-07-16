import { describe, it, expect } from 'vitest';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createListOverrides } from '$lib/editor-actions/list-overrides';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';

// jsdom has no native selection, so every commit here exercises the no-caret
// fallback — the path stored must resolve to the operated child in the
// snapshot it restores (the reorder-action "deep restore path" contract,
// extended to every container commit).

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
			{
				index: 1,
				get node() {
					return deps.doc.children[1];
				},
				path: [1],
				stickyColumn: makeStickyColumn(),
				parent: {
					blockEdit: makeStubBlockEdit(),
					focus: makeStubFocus(),
					containerEdit: createContainerEditActions(deps, controller)
				}
			}
		);

		await bundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		const entry = lastUndoEntry(deps);
		expect(entry.selection.focus.path).toEqual([1, 0]);
		expect(nodeAt(entry.snapshot, entry.selection.focus.path)).toBeTruthy();
	});

	it('container delete stores the deleted item path', async () => {
		const { deps } = makeEditorActionsDeps([listOf(['one\n', 'two\n'])]);
		const controller = createUndoController(deps);
		const state = createBlockListState(() => deps.doc.children[0]);
		const overrides = createListOverrides({
			get index() {
				return 0;
			},
			get node() {
				return deps.doc.children[0];
			},
			get path() {
				return [0];
			},
			state,
			parentBlockEdit: makeStubBlockEdit(),
			parentContainerEdit: createContainerEditActions(deps, controller)
		})({
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
			containerEdit: {} as never
		});

		await overrides.blockEdit!.deleteBlock!(1);

		const entry = lastUndoEntry(deps);
		expect(entry.selection.focus.path).toEqual([0, 1]);
		expect(nodeAt(entry.snapshot, entry.selection.focus.path)).toBeTruthy();
	});

	it('a 2-deep nested metadata update stores the leaf path', async () => {
		const { deps } = makeEditorActionsDeps([para('pad\n'), quoteOf([listOf(['one\n'])])]);
		const controller = createUndoController(deps);
		const rootContainerEdit = createContainerEditActions(deps, controller);
		const liveQuote = () => deps.doc.children[1];
		const liveList = () => liveQuote().children![0];

		const quoteBundle = createStandardNestedActions(createBlockListState(liveQuote), {
			index: 1,
			get node() {
				return liveQuote();
			},
			path: [1],
			stickyColumn: makeStickyColumn(),
			parent: {
				blockEdit: makeStubBlockEdit(),
				focus: makeStubFocus(),
				containerEdit: rootContainerEdit
			}
		});
		const listBundle = createStandardNestedActions(createBlockListState(liveList), {
			index: 0,
			get node() {
				return liveList();
			},
			path: [1, 0],
			stickyColumn: makeStickyColumn(),
			parent: quoteBundle
		});

		await listBundle.blockEdit.updateBlockMetadata(0, { taskChecked: true });

		const entry = lastUndoEntry(deps);
		expect(entry.selection.focus.path).toEqual([1, 0, 0]);
		expect(nodeAt(entry.snapshot, entry.selection.focus.path)).toBeTruthy();
	});
});

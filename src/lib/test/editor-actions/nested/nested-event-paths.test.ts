import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { nodeAt } from '$lib/tree-operations/node-ops';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createContainerEditActions } from '$lib/editor-actions/container-edit';
import { createStandardNestedActions } from '$lib/editor-actions/nested/nested-actions';
import { createListContext } from '$lib/editor-actions/list-context';
import { createBlockquoteOverrides } from '$lib/editor-actions/blockquote-overrides';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import {
	makeNestedActionsDeps,
	makeStubBlockEdit,
	makeStubFocus,
	makeEditorActionsDeps
} from '$lib/test/harness/editor-actions';
import type { EditEvent } from '$lib/editor-events';
import type { CstNode } from '$lib/core/nodes';

// A list nested in a blockquote: its local index (0) differs from its doc-absolute
// path [1, 0], so a scope-local event path is distinguishable from the absolute one.
function makeNestedList() {
	const harness = makeEditorActionsDeps(parse('pad\n\n> - one\n> - two\n').children);
	const { deps, events } = harness;
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

	const listState = createBlockListState(liveList);
	// indentItem's destination scope resolves the previous item's state from the registry.
	createBlockListState(() => liveList().children![0]);

	const listContext = createListContext({
		scope: {
			get index() {
				return 0;
			},
			get node() {
				return liveList();
			},
			get path() {
				return [1, 0];
			}
		},
		state: listState,
		parentBlockEdit: quoteBundle.blockEdit,
		parentFocus: quoteBundle.focus,
		parentListContext: undefined,
		controller,
		getPresentationMode: undefined
	});

	const edits: EditEvent[] = [];
	events.on('edit', (e) => edits.push(e));
	return { deps, listContext, liveList, edits };
}

describe('nested list ops emit doc-absolute event paths', () => {
	it('insertItemAfter resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.insertItemAfter(0);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});

	it('splitItemAtOffset resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.splitItemAtOffset(0, 0, 2);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});

	it('indentItem resolves to the operated list from the doc root', async () => {
		const h = makeNestedList();
		await h.listContext.indentItem(1);
		expect(h.edits).toHaveLength(1);
		expect(h.edits[0].path).toEqual([1, 0]);
		expect(nodeAt(h.deps.doc, h.edits[0].path)).toBe(h.liveList());
	});
});

describe('nested blockquote exit emits a doc-absolute event path', () => {
	it('Enter on the empty last child of a nested quote targets that quote', async () => {
		const para = (raw: string): CstNode => ({ kind: 'paragraph', leadingTrivia: '', raw });
		const innerQuote: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '> a\n>\n',
			metadata: { quoteDepth: 1 },
			children: [para('a\n'), para('\n')],
			innerPrefix: '> ',
			innerSuffix: ''
		};
		const outerQuote: CstNode = {
			kind: 'blockquote',
			leadingTrivia: '',
			raw: '> > a\n> >\n',
			metadata: { quoteDepth: 1 },
			children: [innerQuote],
			innerPrefix: '> ',
			innerSuffix: ''
		};
		const { deps, events } = makeEditorActionsDeps([para('pad\n'), outerQuote]);
		const controller = createUndoController(deps);
		const liveInner = () => deps.doc.children[1].children![0];

		const overrides = createBlockquoteOverrides({
			scope: {
				get index() {
					return 0;
				},
				get node() {
					return liveInner();
				},
				get path() {
					return [1, 0];
				}
			},
			state: createBlockListState(liveInner),
			parentBlockEdit: makeStubBlockEdit(),
			parentFocus: makeStubFocus(),
			controller
		})({
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
			containerEdit: {} as never
		});

		const edits: EditEvent[] = [];
		events.on('edit', (e) => edits.push(e));

		await overrides.blockEdit!.splitBlock!(1, 0);

		expect(edits).toHaveLength(1);
		expect(edits[0]).toMatchObject({ op: 'delete', path: [1, 0] });
		expect(nodeAt(deps.doc, edits[0].path)).toBe(liveInner());
	});
});

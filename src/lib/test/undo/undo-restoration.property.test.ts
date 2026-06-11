/**
 * Structural-sharing undo keystone: random op sequences over real action
 * factories (top-level + nested chains + multi-scope list ops), then undo-all
 * — every intermediate undo must restore the serialization recorded at that
 * entry's push, byte-exactly. A single missed copy-path-on-write (a write
 * through a snapshot-shared node) corrupts an entry and fails the comparison.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import type { CstNode } from '../../core/nodes';
import { displayLength, trimTrailingLineEnding } from '../../core/lines';
import { createUndoController } from '../../editor-actions/undo-controller';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createContainerEditActions } from '../../editor-actions/container-edit';
import { createHistoryActions } from '../../editor-actions/history';
import { createStandardNestedActions } from '../../editor-actions/nested-actions';
import { createListContext } from '../../editor-actions/list-context';
import { registerBlockListState } from '../../reactivity/state-registry';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubFocus
} from '../harness/editor-actions';

const PARAMS = { numRuns: 40, seed: 20260611 } as const;

type Op =
	| { t: 'typeTop'; i: number; n: number }
	| { t: 'splitTop'; i: number; off: number }
	| { t: 'mergeTopNext'; i: number }
	| { t: 'insertItem'; i: number }
	| { t: 'splitItem'; i: number; off: number }
	| { t: 'indent'; i: number }
	| { t: 'typeItem'; i: number; n: number }
	| { t: 'toggleTask'; i: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
	fc.record({ t: fc.constant('typeTop' as const), i: fc.nat(5), n: fc.nat(2) }),
	fc.record({ t: fc.constant('splitTop' as const), i: fc.nat(5), off: fc.nat(8) }),
	fc.record({ t: fc.constant('mergeTopNext' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('insertItem' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('splitItem' as const), i: fc.nat(5), off: fc.nat(6) }),
	fc.record({ t: fc.constant('indent' as const), i: fc.nat(5) }),
	fc.record({ t: fc.constant('typeItem' as const), i: fc.nat(5), n: fc.nat(2) }),
	fc.record({ t: fc.constant('toggleTask' as const), i: fc.nat(5) })
);

const arbSource = fc.constantFrom(
	'alpha\n\n- one\n- two\n- three\n\nomega\n',
	'1. first\n2. second\n3. third\n',
	'- a\n  - b\n- c\n\npara\n',
	'lead\n\n> quoted\n\n- x\n- y\n'
);

function makeHarness(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return {
		deps,
		controller,
		blockEdit: createBlockEditActions(deps, controller),
		rootContainerEdit: createContainerEditActions(deps, controller),
		history: createHistoryActions(deps, controller)
	};
}

/** Register fresh states for every container in the subtree — the headless
 *  stand-in for component (re)mounting after identity-changing commits. */
function registerSubtreeStates(node: CstNode): void {
	if (!node.children) return;
	registerBlockListState(
		node,
		makeBlockListState(() => node)
	);
	for (const child of node.children) registerSubtreeStates(child);
}

async function runOp(h: ReturnType<typeof makeHarness>, op: Op): Promise<void> {
	const doc = h.deps.doc;
	const listIndex = doc.children.findIndex((c) => c.kind === 'list');
	const list = listIndex === -1 ? undefined : doc.children[listIndex];
	for (const child of doc.children) registerSubtreeStates(child);

	const listParts = () => {
		const listState = makeBlockListState(() => h.deps.doc.children[listIndex]);
		const listDeps = {
			index: listIndex,
			get node() {
				return h.deps.doc.children[listIndex];
			},
			path: [listIndex],
			stickyColumn: makeStickyColumn(),
			parent: {
				blockEdit: h.blockEdit,
				focus: makeStubFocus(),
				containerEdit: h.rootContainerEdit
			}
		};
		const bundle = createStandardNestedActions(listState, listDeps);
		const context = createListContext({
			get index() {
				return listIndex;
			},
			get node() {
				return h.deps.doc.children[listIndex];
			},
			get path() {
				return [listIndex];
			},
			state: listState,
			parentBlockEdit: makeStubBlockEdit(),
			parentFocus: makeStubFocus(),
			parentListContext: undefined,
			controller: h.controller
		});
		return { bundle, context };
	};

	switch (op.t) {
		case 'typeTop':
		case 'splitTop':
		case 'mergeTopNext': {
			const paragraphs = doc.children
				.map((c, i) => ({ c, i }))
				.filter(({ c }) => c.kind === 'paragraph');
			if (paragraphs.length === 0) return;
			const { c, i } = paragraphs[op.i % paragraphs.length];
			if (op.t === 'typeTop') {
				const text = trimTrailingLineEnding(c.raw) + 'x'.repeat(op.n + 1) + '\n';
				await h.blockEdit.updateBlockContent(i, text, 0);
			} else if (op.t === 'splitTop') {
				await h.blockEdit.splitBlock(i, Math.min(op.off, displayLength(c.raw)));
			} else {
				await h.blockEdit.mergeWithNext(i);
			}
			return;
		}
		case 'insertItem':
		case 'splitItem':
		case 'indent':
		case 'toggleTask':
		case 'typeItem': {
			if (!list?.children || list.children.length === 0) return;
			const itemIdx = op.i % list.children.length;
			const item = list.children[itemIdx];
			const { bundle, context } = listParts();
			if (op.t === 'insertItem') {
				await context.insertItemAfter(itemIdx);
			} else if (op.t === 'splitItem') {
				const leaf = item.children?.[0];
				if (leaf?.kind !== 'paragraph') return;
				await context.splitItemAtOffset(itemIdx, 0, Math.min(op.off, displayLength(leaf.raw)));
			} else if (op.t === 'indent') {
				if (itemIdx === 0) return;
				await context.indentItem(itemIdx);
			} else if (op.t === 'toggleTask') {
				const checked =
					item.metadata && 'taskChecked' in item.metadata && item.metadata.taskChecked;
				await bundle.blockEdit.updateBlockMetadata(itemIdx, {
					taskItem: true,
					taskChecked: !checked,
					taskMarker: checked ? '[ ] ' : '[x] '
				});
			} else {
				const leaf = item.children?.[0];
				if (leaf?.kind !== 'paragraph') return;
				const itemState = makeBlockListState(
					() => h.deps.doc.children[listIndex].children![itemIdx]
				);
				const itemBundle = createStandardNestedActions(itemState, {
					index: itemIdx,
					get node() {
						return h.deps.doc.children[listIndex].children![itemIdx];
					},
					path: [listIndex, itemIdx],
					stickyColumn: makeStickyColumn(),
					parent: bundle
				});
				const text = trimTrailingLineEnding(leaf.raw) + 'y'.repeat(op.n + 1) + '\n';
				await itemBundle.blockEdit.updateBlockContent(0, text, 0);
			}
			return;
		}
	}
}

describe('undo restoration property (structural sharing)', () => {
	it('after N random ops, every undo step restores its push-time serialization byte-exactly', async () => {
		await fc.assert(
			fc.asyncProperty(
				arbSource,
				fc.array(arbOp, { minLength: 1, maxLength: 8 }),
				async (source, ops) => {
					const h = makeHarness(source);
					const original = serialize(h.deps.doc);
					// Each undo entry snapshots the pre-op state of the op that
					// pushed it; record one expectation per stack-depth increase.
					const expected: string[] = [];

					for (const op of ops) {
						const before = serialize(h.deps.doc);
						await runOp(h, op);
						while (expected.length < h.deps.undoManager.getStacks().undo.length) {
							expected.push(before);
						}
					}

					for (let depth = h.deps.undoManager.getStacks().undo.length; depth > 0; depth--) {
						await h.history.requestUndo();
						expect(serialize(h.deps.doc)).toBe(expected[depth - 1]);
					}
					expect(serialize(h.deps.doc)).toBe(original);
				}
			),
			PARAMS
		);
	});
});

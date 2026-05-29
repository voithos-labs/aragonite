// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { parse } from '../../../core/parser';
import { registerBlockListState } from '../../../reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { UndoController } from '../../../editor-actions/deps';

function makeStubController(): UndoController {
	return {
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		clearDebouncedCheckpoint: vi.fn()
	} as unknown as UndoController;
}

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

// A controller whose commitMultiScope runs the mutate against copies of each
// scope's children — enough of the real commit primitive to exercise the
// splice + ancestry raw rebuild that the bug corrupts.
function runningController(): UndoController {
	return {
		...makeStubController(),
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: { children: CstNode[] }[]) => unknown;
			}) => {
				mutate(scopes.map((s) => ({ children: [...(s.node.children ?? [])] })));
			}
		)
	} as unknown as UndoController;
}

describe('container-matching paste — empty-target newline-termination (A1)', () => {
	it('pasting a list without a trailing newline into a non-last empty item keeps the following sibling separate', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0] as CstNode;
		// Empty the first item's content to simulate a post-cross-block-delete stub.
		(list.children![0].children![0] as CstNode).raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '- x\n- y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), skipSnapshot: true }
		);

		// The bug mashed the un-terminated last pasted item ("- y") into the
		// following sibling ("- keep") → "- y- keep" on one line.
		expect(list.raw).toBe('- x\n- y\n- keep\n');
	});

	it('populates inline content on spliced items so non-render consumers see fresh trees (A2)', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0] as CstNode;
		(list.children![0].children![0] as CstNode).raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '- x\n- y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), skipSnapshot: true }
		);

		// First spliced item's inner paragraph must carry a parsed inline tree —
		// the sibling absorb/break-out strategies populate it; this branch must too.
		const firstPastedPara = list.children![0].children![0] as CstNode;
		expect(firstPastedPara.inlineContent).toBeDefined();
		expect(firstPastedPara.inlineContent!.length).toBeGreaterThan(0);
	});
});

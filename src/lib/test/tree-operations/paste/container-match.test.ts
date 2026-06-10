// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { findContainerMatchingUnwrap } from '../../../tree-operations/paste/container-match';
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
		const list = doc.children[0];
		// Empty the first item's content to simulate a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
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
		const list = doc.children[0];
		list.children![0].children![0].raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '- x\n- y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), skipSnapshot: true }
		);

		// First spliced item's inner paragraph must carry a parsed inline tree —
		// the sibling absorb/break-out strategies populate it; this branch must too.
		const firstPastedPara = list.children![0].children![0];
		expect(firstPastedPara.inlineContent).toBeDefined();
		expect(firstPastedPara.inlineContent!.length).toBeGreaterThan(0);
	});
});

describe('findContainerMatchingUnwrap — blockquote non-empty target (no wholesale replace)', () => {
	it('returns null for a single-blockquote clipboard pasted into a non-empty blockquote paragraph', () => {
		// Target: a blockquote with one non-empty paragraph. Caret at end of "hello".
		const doc = parse('> hello\n');
		const blockquote = doc.children[0];
		expect(blockquote.kind).toBe('blockquote');
		expect(blockquote.children![0].kind).toBe('paragraph');

		// Clipboard: a single blockquote whose child is a paragraph.
		const clipboard = parse('> world\n');

		// Caret path is [blockquoteIdx, paragraphIdx] = [0, 0]; offset = end of "hello".
		const unwrap = findContainerMatchingUnwrap(doc, [0, 0], 'hello'.length, clipboard, false);

		// The non-empty paragraph must NOT classify as an empty stub. With
		// crossBlockContext=false the merge-first branch can't fire either, so the
		// router defers to default structural paste — no wholesale splice.
		expect(unwrap).toBeNull();
	});

	it('still unwraps when the blockquote paragraph is genuinely empty', () => {
		// A blank blockquote stub (post-cross-block-delete) keeps the empty-target path.
		const doc = parse('> hello\n');
		const blockquote = doc.children[0];
		blockquote.children![0].raw = '';

		const clipboard = parse('> world\n');
		const unwrap = findContainerMatchingUnwrap(doc, [0, 0], 0, clipboard, false);

		expect(unwrap).not.toBeNull();
		expect(unwrap!.merge).toBeUndefined();
		expect(unwrap!.outerPath).toEqual([0]);
	});
});

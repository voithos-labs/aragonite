// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { findContainerMatchingUnwrap } from '../../../tree-operations/paste/container-match';
import { parse } from '../../../core/parser';
import { createSharingState, type SharingState } from '../../../tree-operations/sharing';
import { rebuildOwnedContainer } from '../../../tree-operations/unshare';
import { registerBlockListState } from '../../../reactivity/state-registry';
import { makeStubBlockEdit, makeStubController } from '../../harness/editor-actions';
import type { CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

function registerStubState(node: CstNode): void {
	registerBlockListState(node, {
		innerBlockIds: (node.children ?? []).map((_, i) => `iid-${i}`),
		innerBlockRefs: (node.children ?? []).map(() => undefined as BlockComponent | undefined)
	} as unknown as Parameters<typeof registerBlockListState>[1]);
}

// Mirrors the real primitive's owned-scope protocol: attach working children, run
// mutate, rebuild scope raws.
function runningController(): UndoController & PasteCommitCoordinator {
	return {
		...makeStubController(),
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: { children: CstNode[]; node: CstNode; sharing: SharingState }[]) => unknown;
			}) => {
				const sharing = createSharingState();
				const views = scopes.map((s) => {
					const children = [...(s.node.children ?? [])];
					s.node.children = children;
					return { children, node: s.node, sharing };
				});
				mutate(views);
				for (const s of scopes) rebuildOwnedContainer(s.node, sharing);
			}
		)
	} as unknown as UndoController & PasteCommitCoordinator;
}

describe('container-matching paste — empty-target newline-termination (A1)', () => {
	it('pasting a list without a trailing newline into a non-last empty item keeps the following sibling separate', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '- x\n- y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		// An un-terminated last pasted item mashes into the following sibling on one line.
		expect(list.raw).toBe('- x\n- y\n- keep\n');
	});
});

describe('findContainerMatchingUnwrap — blockquote non-empty target (no wholesale replace)', () => {
	it('returns null for a single-blockquote clipboard pasted into a non-empty blockquote paragraph', () => {
		const doc = parse('> hello\n');
		const blockquote = doc.children[0];
		expect(blockquote.kind).toBe('blockquote');
		expect(blockquote.children![0].kind).toBe('paragraph');

		const clipboard = parse('> world\n');

		const unwrap = findContainerMatchingUnwrap(doc, [0, 0], 'hello'.length, clipboard, false);

		// A non-empty paragraph must not classify as an empty stub, and crossBlockContext=false
		// keeps the merge-first branch from firing, so the router defers to structural paste.
		expect(unwrap).toBeNull();
	});

	it('still unwraps when the blockquote paragraph is genuinely empty', () => {
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

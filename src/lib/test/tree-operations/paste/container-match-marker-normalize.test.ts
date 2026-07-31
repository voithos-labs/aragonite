// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { pasteDispatch } from '../../../tree-operations/paste/dispatch';
import { parse } from '../../../core/parser';
import { createSharingState, type SharingState } from '../../../tree-operations/sharing';
import { rebuildOwnedContainer } from '../../../tree-operations/unshare';
import {
	expectStateForNode,
	getStateForNode,
	registerBlockListState
} from '../../../reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { metadataOf, type CstNode } from '../../../core/nodes';
import type { BlockComponent } from '../../../block-component';
import type { UndoController } from '../../../editor-actions/deps';
import type { PasteCommitCoordinator } from '../../../tree-operations/paste/paste-deps';

// Splicing pasted list items into a matching ancestor without templating their bullet
// glyph leaves a `*` inside a `- ` list, which reference parsers split into two lists.
// Mirrors the list-absorb unordered-marker fix.

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
		sharing: createSharingState(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode,
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

describe('container-matching paste — unordered marker normalization', () => {
	it('templates pasted "*" markers to the enclosing "-" list on the empty-target route', async () => {
		const doc = parse('- a\n- keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '* x\n* y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'- ',
			'- ',
			'- '
		]);
		expect(list.raw).toBe('- x\n- y\n- keep\n');
	});

	it('templates pasted "*" markers to the enclosing "-" list on the non-empty merge route', async () => {
		const doc = parse('- alpha\n- keep\n');
		const list = doc.children[0];
		registerStubState(list);

		// A cross-block 'join' paste takes the merge-first branch, splicing the trailing pasted
		// item as a sibling.
		await pasteDispatch(
			{ pastedText: '* x\n* y\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'- ',
			'- ',
			'- '
		]);
		expect(list.raw).toBe('- alphax\n- y\n- keep\n');
	});
});

// Ordered items spliced with their pasted numbers intact leave the source misnumbered,
// which reference renderers mask by re-sequencing. Mirrors the sibling-absorb renumber.
describe('container-matching paste — ordered renumbering', () => {
	it('renumbers pasted ordered items into the sequence on the empty-target route', async () => {
		const doc = parse('1. a\n2. keep\n');
		const list = doc.children[0];
		// An emptied first item stands in for a post-cross-block-delete stub.
		list.children![0].children![0].raw = '';
		registerStubState(list);

		await pasteDispatch(
			{ pastedText: '1. x\n2. y', targetPath: [0, 0, 0], offset: 0 },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'1. ',
			'2. ',
			'3. '
		]);
		expect(list.raw).toBe('1. x\n2. y\n3. keep\n');
	});

	it('renumbers the spliced siblings and tail on the non-empty merge route', async () => {
		const doc = parse('1. alpha\n2. keep\n');
		const list = doc.children[0];
		registerStubState(list);

		// A cross-block 'join' paste takes the merge-first branch, splicing the trailing pasted
		// item as a sibling.
		await pasteDispatch(
			{ pastedText: '1. x\n2. y\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{ doc, blockEdit: makeStubBlockEdit(), controller: runningController(), undoEntry: 'join' }
		);

		expect(list.children!.map((it) => metadataOf(it, 'listItem').marker)).toEqual([
			'1. ',
			'2. ',
			'3. '
		]);
		expect(list.raw).toBe('1. alphax\n2. y\n3. keep\n');
	});
});

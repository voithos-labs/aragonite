// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pasteDispatch, __getDefaultTextSurface } from '$lib/tree-operations/paste/dispatch';
import {
	__resetPasteSurfacesForTests,
	registerPasteSurface
} from '$lib/tree-operations/paste-surfaces';
import { parse } from '$lib/core/parser';
import { createSharingState } from '$lib/tree-operations/sharing';
import {
	expectStateForNode,
	getStateForNode,
	registerBlockListState
} from '$lib/reactivity/state-registry';
import { makeStubBlockEdit } from '../../harness/editor-actions';
import { metadataOf, type CstNode } from '$lib/core/nodes';
import type { UndoController } from '$lib/editor-actions/deps';
import type { PasteCommitCoordinator } from '$lib/tree-operations/paste/paste-deps';

// Absorbing a same-type list paste must normalize markers for BOTH halves: a `*` kept
// inside a `- ` list is split into two lists by reference parsers.

function makeController(): UndoController & PasteCommitCoordinator {
	return {
		sharing: createSharingState(),
		pushUndoSnapshot: vi.fn(),
		pushUndoSnapshotDebounced: vi.fn(),
		commitStructural: vi.fn(),
		commitContainerStructural: vi.fn(),
		commitMultiScope: vi.fn(
			async ({
				scopes,
				mutate
			}: {
				scopes: { node: CstNode }[];
				mutate: (v: unknown[]) => void;
			}) => {
				const sharing = createSharingState();
				mutate(scopes.map((s) => ({ children: s.node.children ?? [], node: s.node, sharing })));
			}
		),
		getDocScope: vi.fn(),
		captureCurrentState: vi.fn(),
		collapsedSelectionAt: vi.fn(),
		resolveState: getStateForNode,
		expectState: expectStateForNode
	} as unknown as UndoController & PasteCommitCoordinator;
}

describe('list-absorb — marker normalization', () => {
	beforeEach(() => {
		__resetPasteSurfacesForTests();
		registerPasteSurface(__getDefaultTextSurface('paragraph'));
	});

	it("templates pasted '*' markers to the enclosing '-' list", async () => {
		const doc = parse('- alpha\n- beta\n');
		const list = doc.children[0];
		registerBlockListState(list, {
			innerBlockIds: list.children!.map((_, i) => `iid-${i}`),
			innerBlockRefs: list.children!.map(() => undefined)
		} as unknown as Parameters<typeof registerBlockListState>[1]);

		// A single-caret paste routes to list-absorb rather than the container-match merge.
		await pasteDispatch(
			{ pastedText: '* one\n* two\n', targetPath: [0, 0, 0], offset: 'alpha'.length },
			{ doc, blockEdit: makeStubBlockEdit(), controller: makeController() }
		);

		const markers = list.children!.map((it) => metadataOf(it, 'listItem').marker);
		expect(markers).toEqual(['- ', '- ', '- ', '- ']);
		expect(list.children!.map((it) => it.raw.startsWith('* '))).toEqual([
			false,
			false,
			false,
			false
		]);
		expect(list.children!.map((it) => it.children?.[0]?.raw?.trim())).toEqual([
			'alpha',
			'one',
			'two',
			'beta'
		]);
	});
});

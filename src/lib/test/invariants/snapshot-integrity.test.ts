import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse } from '../../core/parser';
import { checkSnapshotIntegrity } from '../../invariants/snapshot-integrity';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { createListContext } from '../../editor-actions/list-context';
import { registerBlockListState } from '../../reactivity/state-registry';
import type { EditorActionsDeps } from '../../editor-actions/deps';
import {
	makeBlockListState,
	makeEditorActionsDeps,
	makeStubBlockEdit,
	makeStubFocus
} from '../harness/editor-actions';

function makeHarness(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	return { deps, controller, blockEdit: createBlockEditActions(deps, controller) };
}

function topEntry(deps: EditorActionsDeps) {
	const undo = deps.undoManager.getStacks().undo;
	return undo[undo.length - 1];
}

describe('checkSnapshotIntegrity (G1.9)', () => {
	beforeEach(() => vi.stubEnv('DEV', true));
	afterEach(() => vi.unstubAllEnvs());

	it('fires when serialized bytes are written through a shared node', () => {
		const { deps, controller } = makeHarness('hello\n');
		controller.pushUndoSnapshot(0, 0);
		// Missed copy-path-on-write: the live ref and the entry share this node.
		deps.doc.children[0].raw = 'corrupted\n';
		expect(checkSnapshotIntegrity(topEntry(deps))?.code).toBe('snapshot-integrity');
	});

	it('passes across a correctly unshared mutation sequence', async () => {
		const { deps, blockEdit } = makeHarness('hello\n\nworld\n');
		await blockEdit.updateBlockContent(0, 'hello more\n', 0);
		await blockEdit.splitBlock(1, 2);
		const { undo } = deps.undoManager.getStacks();
		expect(undo.length).toBeGreaterThan(0);
		for (const entry of undo) expect(checkSnapshotIntegrity(entry)).toBeNull();
	});

	it('does not fire when a still-shared node is moved by the live tree (exempt: bytes-scoped, not frozen-position)', async () => {
		const { deps, controller } = makeHarness('- a\n- b\n');
		const list = deps.doc.children[0];
		const item1 = list.children![1];
		const listState = makeBlockListState(() => deps.doc.children[0]);
		registerBlockListState(list, listState);
		for (const item of list.children!) {
			registerBlockListState(
				item,
				makeBlockListState(() => item)
			);
		}
		const ctx = createListContext({
			get index() {
				return 0;
			},
			get node() {
				return deps.doc.children[0];
			},
			get path() {
				return [0];
			},
			state: listState,
			parentBlockEdit: makeStubBlockEdit(),
			parentFocus: makeStubFocus(),
			parentListContext: undefined,
			controller
		});

		// Unordered indent re-parents item 1 under item 0 without rewriting its
		// bytes (no marker renumbering), so the shared node moves by reference.
		await ctx.indentItem(1);

		const entry = topEntry(deps);
		const movedItem = deps.doc.children[0].children![0].children!.at(-1)!.children![0];
		expect(movedItem).toBe(item1);
		expect(movedItem).toBe(entry.snapshot.children[0].children![1]);
		expect(deps.sharing.isShared(movedItem)).toBe(true);
		expect(checkSnapshotIntegrity(entry)).toBeNull();
	});
});

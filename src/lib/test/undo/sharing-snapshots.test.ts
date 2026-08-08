import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { createBlockEditActions } from '../../editor-actions/block-edit';
import { makeEditorActionsDeps, makeNestedHarness } from '../harness/editor-actions';

function makeHarness(source: string) {
	const { deps } = makeEditorActionsDeps(parse(source).children);
	const controller = createUndoController(deps);
	const history = createHistoryActions(deps, controller);
	return { deps, controller, history };
}

describe('structural-sharing snapshots', () => {
	beforeEach(() => vi.mocked(devWarn).mockClear());

	it('a snapshot push shares nodes instead of cloning them', () => {
		const { deps, controller } = makeHarness('hello\n\nworld\n');
		controller.pushUndoSnapshot(0, 0);
		const entry = deps.undoManager.getStacks().undo[0];
		expect(entry.snapshot.children[0]).toBe(deps.doc.children[0]);
		expect(entry.snapshot.children[1]).toBe(deps.doc.children[1]);
		expect(entry.snapshot.children).not.toBe(deps.doc.children);
	});

	it('a snapshot push bumps the epoch so live nodes read as shared', () => {
		const { deps, controller } = makeHarness('hello\n');
		expect(deps.sharing.isShared(deps.doc.children[0])).toBe(false);
		controller.pushUndoSnapshot(0, 0);
		expect(deps.sharing.isShared(deps.doc.children[0])).toBe(true);
	});

	it('undo restore bumps the epoch beyond the swap capture', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		controller.pushUndoSnapshot(0, 0);
		const beforeUndo: { ownerEpoch?: number } = {};
		deps.sharing.stamp(beforeUndo);
		await history.requestUndo();
		const afterUndo: { ownerEpoch?: number } = {};
		deps.sharing.stamp(afterUndo);
		// One bump for the swap capture, one for the restore itself.
		expect(afterUndo.ownerEpoch! - beforeUndo.ownerEpoch!).toBe(2);
	});

	it('restore re-copies the children array so the stack entry never aliases the live array', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		controller.pushUndoSnapshot(0, 0);
		const entry = deps.undoManager.getStacks().undo[0];
		await history.requestUndo();
		expect(deps.doc.children).not.toBe(entry.snapshot.children);
		expect(deps.doc.children[0]).toBe(entry.snapshot.children[0]);
	});

	it('DEV integrity digest is stored at push and passes at unmutated restore', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		controller.pushUndoSnapshot(0, 0);
		expect(deps.undoManager.getStacks().undo[0].integrity).toBeDefined();
		await history.requestUndo();
		expect(devWarn).not.toHaveBeenCalled();
	});

	// GH #73: filling a blank block hands its follower the separator the blank line had been —
	// a node the caller's unshare never covered, since it only owns the block being typed into.
	// Miss-analysis: every sharing case drove a write to the block the gesture NAMES, so the one
	// op that writes a bystander's bytes had no pin.
	it('a blank fill unshares the follower it hands the separator to', async () => {
		const { deps, controller, history } = makeHarness('alpha\n\n\ndelta\n');
		const actions = createBlockEditActions(deps, controller);
		controller.pushUndoSnapshot(1, 0);

		await actions.updateBlockContent(1, 'x\n');
		await history.requestUndo();

		expect(devWarn).not.toHaveBeenCalled();
		expect(serialize(deps.doc)).toBe('alpha\n\n\ndelta\n');
	});

	it('mutating a shared node between push and restore trips the integrity oracle', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		controller.pushUndoSnapshot(0, 0);
		// Simulates a missed unshare: a raw write through a node the entry shares.
		deps.doc.children[0].raw = 'corrupted\n';
		await history.requestUndo();
		expect(devWarn).toHaveBeenCalledWith(
			'invariant:snapshot-integrity',
			expect.stringContaining('undo: snapshot digest mismatch'),
			'snapshot-integrity'
		);
	});
	// GH #73: the nested door hands the follower the same separator, and the spine unshare copies
	// the CONTAINER, so the snapshot's digest never sees a write to a still-shared grandchild.
	// Miss-analysis: the oracle only descends the doc root, so no nested sharing case could fire it.
	it('a blank fill inside a container unshares the follower it hands the separator to', async () => {
		const h = makeNestedHarness('> alpha\n>\n>\n> delta\n', { index: 0 });
		h.controller.pushUndoSnapshot(0, 0);
		const shared = h.deps.undoManager.getStacks().undo[0].snapshot.children[0].children![2];
		expect(shared.leadingTrivia).toBe('');

		await h.bundle.blockEdit.updateBlockContent(1, 'x\n', 1);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n> x\n>\n> delta\n');
		expect(shared.leadingTrivia).toBe('');
	});

	// GH #96: the reverse transition takes a separator BACK, and the run member giving it up can
	// sit two slots below the block the gesture names — the widest reach any settle has.
	// Miss-analysis: the #73 cases pinned a write to the immediate follower, so a settle that
	// walked further would have shipped its bystander writes unshared.
	it('emptying a block unshares the run member two slots below it', async () => {
		const { deps, controller } = makeHarness('Hello\n\nSecond\n');
		const actions = createBlockEditActions(deps, controller);
		await actions.splitBlock(0, 5);
		await actions.splitBlock(1, 0);
		await actions.updateBlockContent(1, 'x\n');
		controller.pushUndoSnapshot(1, 0);
		const shared = deps.undoManager.getStacks().undo.at(-1)!.snapshot.children[3];
		expect(shared.leadingTrivia).toBe('\n');

		await actions.updateBlockContent(1, '\n');

		expect(serialize(deps.doc)).toBe('Hello\n\n\n\nSecond\n');
		expect(shared.leadingTrivia).toBe('\n');
		expect(deps.doc.children[3]).not.toBe(shared);
	});

	it('emptying a block inside a container unshares the follower it settles', async () => {
		const h = makeNestedHarness('> alpha\n>\n> x\n>\n> delta\n', { index: 0 });
		h.controller.pushUndoSnapshot(0, 0);
		const shared = h.deps.undoManager.getStacks().undo[0].snapshot.children[0].children![2];
		expect(shared.leadingTrivia).toBe('\n');

		await h.bundle.blockEdit.updateBlockContent(1, '\n', 1);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n>\n> delta\n');
		expect(shared.leadingTrivia).toBe('\n');
	});
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { parse } from '../../core/parser';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { makeEditorActionsDeps } from '../harness/editor-actions';

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
});

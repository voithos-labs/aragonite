import { describe, it, expect } from 'vitest';

import { takeDevWarns } from '../support/warn-gate';
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
	it('a snapshot push shares nodes instead of cloning them', () => {
		const { deps, controller } = makeHarness('hello\n\nworld\n');
		deps.undoManager.push(controller.captureCurrentState());
		const entry = deps.undoManager.getStacks().undo[0];
		expect(entry.snapshot.children[0]).toBe(deps.doc.children[0]);
		expect(entry.snapshot.children[1]).toBe(deps.doc.children[1]);
		expect(entry.snapshot.children).not.toBe(deps.doc.children);
	});

	it('a snapshot push bumps the epoch so live nodes read as shared', () => {
		const { deps, controller } = makeHarness('hello\n');
		expect(deps.sharing.isShared(deps.doc.children[0])).toBe(false);
		deps.undoManager.push(controller.captureCurrentState());
		expect(deps.sharing.isShared(deps.doc.children[0])).toBe(true);
	});

	it('undo restore bumps the epoch beyond the swap capture', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		deps.undoManager.push(controller.captureCurrentState());
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
		deps.undoManager.push(controller.captureCurrentState());
		const entry = deps.undoManager.getStacks().undo[0];
		await history.requestUndo();
		expect(deps.doc.children).not.toBe(entry.snapshot.children);
		expect(deps.doc.children[0]).toBe(entry.snapshot.children[0]);
	});

	it('DEV integrity digest is stored at push and passes at unmutated restore', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		deps.undoManager.push(controller.captureCurrentState());
		expect(deps.undoManager.getStacks().undo[0].integrity).toBeDefined();
		await history.requestUndo();
		expect(takeDevWarns()).toEqual([]);
	});

	// Filling a blank block hands its separator to the next block, which the caller never copied.
	// Miss-analysis: GH #73; every sharing case wrote only the block the gesture names.
	it('a blank fill unshares the follower it hands the separator to', async () => {
		const { deps, controller, history } = makeHarness('alpha\n\n\ndelta\n');
		const actions = createBlockEditActions(deps, controller);
		deps.undoManager.push(controller.captureCurrentState());

		await actions.updateBlockContent(1, 'x\n', 'authored');
		await history.requestUndo();

		expect(takeDevWarns()).toEqual([]);
		expect(serialize(deps.doc)).toBe('alpha\n\n\ndelta\n');
	});

	it('mutating a shared node between push and restore trips the integrity check', async () => {
		const { deps, controller, history } = makeHarness('hello\n');
		deps.undoManager.push(controller.captureCurrentState());
		// Stands in for a missed copy-before-write: a raw write through a node the entry shares.
		deps.doc.children[0].raw = 'corrupted\n';
		await history.requestUndo();
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['invariant:snapshot-integrity']);
		expect(fires[0].message).toContain('undo: snapshot digest mismatch');
		expect(fires[0].details).toBe('snapshot-integrity');
	});
	// Copying the ancestors copies the container, so the digest never sees the shared grandchild.
	// Miss-analysis: GH #73; the digest descends only from the root, so no nested case trips it.
	it('a blank fill inside a container unshares the follower it hands the separator to', async () => {
		const h = makeNestedHarness('> alpha\n>\n>\n> delta\n', { index: 0 });
		h.deps.undoManager.push(h.controller.captureCurrentState());
		const shared = h.deps.undoManager.getStacks().undo[0].snapshot.children[0].children![2];
		expect(shared.leadingTrivia).toBe('');

		await h.bundle.blockEdit.updateBlockContent(1, 'x\n', 'authored', 1);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n> x\n>\n> delta\n');
		expect(shared.leadingTrivia).toBe('');
	});

	// Taking a separator back can write the block two below, the furthest a fix-up reaches.
	// Miss-analysis: GH #96; the separator cases only ever wrote the very next block.
	it('emptying a block unshares the run member two slots below it', async () => {
		const { deps, controller } = makeHarness('Hello\n\nSecond\n');
		const actions = createBlockEditActions(deps, controller);
		await actions.splitBlock(0, 5);
		await actions.splitBlock(1, 0);
		await actions.updateBlockContent(1, 'x\n', 'authored');
		deps.undoManager.push(controller.captureCurrentState());
		const shared = deps.undoManager.getStacks().undo.at(-1)!.snapshot.children[3];
		expect(shared.leadingTrivia).toBe('\n');

		await actions.updateBlockContent(1, '\n', 'authored');

		expect(serialize(deps.doc)).toBe('Hello\n\n\n\nSecond\n');
		expect(shared.leadingTrivia).toBe('\n');
		expect(deps.doc.children[3]).not.toBe(shared);
	});

	it('emptying a block inside a container unshares the follower it settles', async () => {
		const h = makeNestedHarness('> alpha\n>\n> x\n>\n> delta\n', { index: 0 });
		h.deps.undoManager.push(h.controller.captureCurrentState());
		const shared = h.deps.undoManager.getStacks().undo[0].snapshot.children[0].children![2];
		expect(shared.leadingTrivia).toBe('\n');

		await h.bundle.blockEdit.updateBlockContent(1, '\n', 'authored', 1);

		expect(serialize(h.deps.doc)).toBe('> alpha\n>\n>\n> delta\n');
		expect(shared.leadingTrivia).toBe('\n');
	});
});

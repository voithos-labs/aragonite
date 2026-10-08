import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeInlineContent } from '../../core/inline';
import { getInlineContent } from '../../core/inline/inline-cache';
import { updateNodeContent } from '../../tree-operations/content-write';
import { createUndoController } from '../../editor-actions/commit/undo-controller';
import { createHistoryActions } from '../../editor-actions/commit/history';
import { makeEditorActionsDeps } from '../harness/editor-actions';
import type { CstNode } from '../../core/nodes';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '../../perf/instruments';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

// The measurement edits a node an undo snapshot shares by writing raw directly rather than
// through a commit, which is what the shared-node check reports.
afterEach(() => allowDevWarns(['invariant:snapshot-integrity']));

// Only `computeInlineContent` bumps `inlineComputeCount`, so an eager inline parse reintroduced
// anywhere shows up where these checks expect zero.

/** A paragraph a blank line below the one before it, so the write asks no join. */
function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '\n', raw };
}

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

// ── Check 1: one compute per rendered keystroke, none on the update path ─────

describe('lazy inline: common keystroke computes once', () => {
	it('updateNodeContent parses no inline; the render compute is the only one', () => {
		const parent = {
			children: [para('alpha\n'), para('beta\n'), para('gamma\n')],
			owner: undefined,
			lineEnding: '\n' as const
		};

		updateNodeContent(parent, 1, 'beta!\n', defaultGrammarView, createSharingState());
		// The content-update path parses the block but must not build its inline tree.
		expect(perfSnapshot().inlineComputeCount).toBe(0);

		computeInlineContent(parent.children[1], undefined, defaultGrammarView);
		expect(perfSnapshot().inlineComputeCount).toBe(1);
	});

	it('an off-render accessor read computes on demand, not eagerly', () => {
		const parent = {
			children: [para('alpha\n'), para('beta\n'), para('gamma\n')],
			owner: undefined,
			lineEnding: '\n' as const
		};

		updateNodeContent(parent, 1, 'beta!\n', defaultGrammarView, createSharingState());
		computeInlineContent(parent.children[1], undefined, defaultGrammarView);
		expect(perfSnapshot().inlineComputeCount).toBe(1);

		// A different block, never read, adds exactly one compute when something finally reads it,
		// which proves nothing filled the whole document in advance.
		getInlineContent(parent.children[2], undefined, undefined, defaultGrammarView);
		expect(perfSnapshot().inlineComputeCount).toBe(2);
	});
});

// ── Check 2: an undo restore parses no inline by itself ──────────────────────

describe('lazy inline: undo restore does no inline work', () => {
	it('restoring a 50-block snapshot parses no inline', async () => {
		const blocks = Array.from({ length: 50 }, (_, i) => para(`line ${i}\n`));
		const { deps } = makeEditorActionsDeps(blocks);
		const controller = createUndoController(deps);
		const history = createHistoryActions(deps, controller);

		deps.undoManager.push(controller.captureCurrentState());
		deps.doc.children[0].raw = 'edited\n';

		resetPerfInstruments();
		await history.requestUndo();

		// The restore reads no inline content whatever the document's size; a rendered block
		// recomputes only when something asks.
		expect(perfSnapshot().inlineComputeCount).toBe(0);
	});
});

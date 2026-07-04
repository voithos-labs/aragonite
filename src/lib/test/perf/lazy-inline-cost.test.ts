import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeInlineContent } from '../../core/inline';
import { getInlineContent } from '../../core/inline/inline-cache';
import { updateNodeContent } from '../../tree-operations/node-ops';
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

// inlineComputeCount has a single production caller — computeInlineContent — so
// it is an exact meter of how often the inline tree is actually built. Both
// guards assert against that meter: a regression that re-introduces eager inline
// parsing bumps it where these tests expect zero.

function para(raw: string): CstNode {
	return { kind: 'paragraph', leadingTrivia: '', raw };
}

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

// ── Guard 1 — one compute per rendered keystroke, none on the update path ────

describe('lazy inline: common keystroke computes once', () => {
	it('updateNodeContent parses no inline; the render compute is the only one', () => {
		const parent = { children: [para('alpha\n'), para('beta\n'), para('gamma\n')] };

		updateNodeContent(parent, 1, 'beta!\n');
		// The content-update path block-parses kind/metadata/children but must not
		// build the inline tree. An eager double-parse here is the regression.
		expect(perfSnapshot().inlineComputeCount).toBe(0);

		computeInlineContent(parent.children[1]);
		expect(perfSnapshot().inlineComputeCount).toBe(1);
	});

	it('an off-render accessor read computes on demand, not eagerly', () => {
		const parent = { children: [para('alpha\n'), para('beta\n'), para('gamma\n')] };

		updateNodeContent(parent, 1, 'beta!\n');
		computeInlineContent(parent.children[1]);
		expect(perfSnapshot().inlineComputeCount).toBe(1);

		// A different, never-read block adds exactly one compute when a consumer
		// finally reads it — proof no eager whole-doc populate ran.
		getInlineContent(parent.children[2]);
		expect(perfSnapshot().inlineComputeCount).toBe(2);
	});
});

// ── Guard 2 — undo restore parses no inline by itself ────────────────────────

describe('lazy inline: undo restore does no inline work', () => {
	it('restoring a 50-block snapshot parses no inline', async () => {
		const blocks = Array.from({ length: 50 }, (_, i) => para(`line ${i}\n`));
		const { deps } = makeEditorActionsDeps(blocks);
		const controller = createUndoController(deps);
		const history = createHistoryActions(deps, controller);

		controller.pushUndoSnapshot(0, 0);
		deps.doc.children[0].raw = 'edited\n';

		resetPerfInstruments();
		await history.requestUndo();

		// The restore primitive reads no inline regardless of doc size; rendered
		// blocks recompute lazily on demand. (The deleted sweep lived in the shell
		// edit-subscriber, not here — a regression there is e2e-scoped, not unit.)
		expect(perfSnapshot().inlineComputeCount).toBe(0);
	});
});

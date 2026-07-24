import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { mockRef, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import { expectParseConverged } from '$lib/test/harness/parse-converged';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { footnotesPlugin } from '$lib/plugins/footnotes';

// A strip plugin container reorders its body children within itself — the seam the
// 0.9.34 quote-unwrap capability climb did not reach. Both gestures (keyboard nudge,
// drag move) flow through the shared resolveReorderUnit seam. The corruption hazard the
// ledger flagged (rebuild-as-blockquote drops the `[!TYPE]` marker) is masked in
// committed state by the commit ceremony re-rebuilding the scope through its own
// descriptor — so these tests pin the OBSERVABLE contract: the body child reorders
// within, the marker survives, and the tree converges with its reparse.

beforeAll(() => {
	installPlugins([admonitionsPlugin(), footnotesPlugin()]);
});

// Mirrors reorder-action.test.ts makeContainer: seed innerBlockRefs to mimic a mounted
// container and register the live node's state so expectStateForNode resolves.
function makeContainer(source: string) {
	const initial = parse(source).children[0];
	const harness = makeEditorActionsDeps([initial]);
	const node = () => harness.doc.children[0];
	const controller = createUndoController(harness.deps);
	const history = createHistoryActions(harness.deps, controller);
	const reorder = createReorderAction(harness.deps, controller);
	const state = createBlockListState(node);
	state.innerBlockRefs = (initial.children ?? []).map(() => mockRef());
	return {
		doc: harness.doc,
		reorder,
		undo: history.requestUndo,
		undoDepth: () => harness.deps.undoManager.getStacks().undo.length,
		assertStable() {
			expectParseConverged(harness.doc);
			const live = serialize(harness.doc);
			expect(serialize(parse(live))).toBe(live);
		}
	};
}

describe('reorder action — githubAlert body children reorder within', () => {
	it('drag move reorders the body child within and keeps the [!TYPE] marker', async () => {
		const h = makeContainer('> [!NOTE]\n> a\n>\n> b\n');
		await h.reorder.moveReorderUnit([0, 0], 1); // first body child -> last
		expect(serialize(h.doc)).toBe('> [!NOTE]\n> b\n>\n> a\n');
		h.assertStable();
	});

	it('nudge down reorders the body child within and keeps the marker', async () => {
		const h = makeContainer('> [!TIP]\n> a\n>\n> b\n');
		await h.reorder.nudgeReorderUnit([0, 0], 1);
		expect(serialize(h.doc)).toBe('> [!TIP]\n> b\n>\n> a\n');
		h.assertStable();
	});

	it('the within-alert reorder is one undo entry and restores in one step', async () => {
		const h = makeContainer('> [!NOTE]\n> a\n>\n> b\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		expect(h.undoDepth()).toBe(1);
		await h.undo();
		expect(serialize(h.doc)).toBe('> [!NOTE]\n> a\n>\n> b\n');
	});
});

describe('reorder action — footnote-def body children reorder within', () => {
	it('drag move reorders the body child within and keeps the [^label]: marker', async () => {
		const h = makeContainer('[^a]: first\n\n    second\n');
		await h.reorder.moveReorderUnit([0, 0], 1);
		const live = serialize(h.doc);
		expect(live).toContain('[^a]:');
		expect(live.indexOf('second')).toBeLessThan(live.indexOf('first'));
		h.assertStable();
	});
});

// The teleport the fix removes: an alert between two paragraphs must not drag the whole
// alert among the document siblings when a body child is nudged.
describe('reorder action — no whole-alert teleport', () => {
	function makeDocWithAlert() {
		const nodes = parse('top\n\n> [!NOTE]\n> a\n>\n> b\n\nbottom\n').children;
		const harness = makeEditorActionsDeps(nodes);
		const controller = createUndoController(harness.deps);
		const reorder = createReorderAction(harness.deps, controller);
		const alert = () => harness.doc.children[1];
		const state = createBlockListState(alert);
		state.innerBlockRefs = (alert().children ?? []).map(() => mockRef());
		return { doc: harness.doc, reorder };
	}

	it('nudging a body child reorders within; top/bottom siblings stay put', async () => {
		const h = makeDocWithAlert();
		await h.reorder.nudgeReorderUnit([1, 0], 1); // alert body child 0 down
		const live = serialize(h.doc);
		expect(live.startsWith('top\n')).toBe(true);
		expect(live.trimEnd().endsWith('bottom')).toBe(true);
		expect(live).toContain('[!NOTE]');
		expect(live).toBe('top\n\n> [!NOTE]\n> b\n>\n> a\n\nbottom\n');
	});
});

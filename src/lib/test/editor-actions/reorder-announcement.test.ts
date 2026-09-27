import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { stubBlockComponent, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';
import { READING_WRITE_TAG } from '$lib/editor-actions/commit/reading-write-gate';
import type { PresentationMode } from '$lib/presentation-mode';
import { fixtureReading } from '../harness/fixture-grammar';
import { takeDevWarns } from '../support/warn-gate';

// What a reorder reports, at both levels: the a11y announcement and where the caret goes. A
// move can make two neighbours merge, and the merge changes both the destination and the
// sibling count, neither of which the pre-commit node can answer, since the commit copies it.
// Miss-analysis: onReorder had no test at any level, and the caret index only at the primitive.

/**
 * Every index answers and records the index it was asked for, as a mounted document does: a
 * merge's `idMap: {0:0}` leaves `undefined` where a mounted editor holds a component.
 */
function refsAnsweringEverySlot(
	slots: (BlockComponent | undefined)[],
	focused: number[]
): (BlockComponent | undefined)[] {
	return new Proxy(slots, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) {
				const index = Number(prop);
				return stubBlockComponent({ focus: () => focused.push(index) });
			}
			return Reflect.get(target, prop, receiver);
		}
	});
}

/** Deps in `mode`, and a controller that records what the edit live region was told. */
function announcingDeps(source: string, mode: PresentationMode) {
	const announced: string[] = [];
	const harness = makeEditorActionsDeps(parse(source), { reading: fixtureReading({}, mode) });
	const controller = createUndoController(harness.deps, (message) => announced.push(message));
	return { harness, announced, controller };
}

function makeTop(source: string, mode: PresentationMode = 'source') {
	const { harness, announced, controller } = announcingDeps(source, mode);
	const focused: number[] = [];
	const refs = refsAnsweringEverySlot(harness.getBlockRefs(), focused);
	const deps = new Proxy(harness.deps, {
		get: (target, prop) => (prop === 'blockRefs' ? refs : Reflect.get(target, prop, target))
	});
	const reorder = createReorderAction(deps, controller);
	return { doc: harness.doc, reorder, announced, focused };
}

function makeContainer(source: string, mode: PresentationMode = 'source') {
	const { harness, announced, controller } = announcingDeps(source, mode);
	const node = () => harness.doc.children[0];
	const state = createBlockListState(node);
	const focused: number[] = [];
	const refs = refsAnsweringEverySlot(state.innerBlockRefs, focused);
	registerBlockListState(
		node(),
		new Proxy(state, {
			get: (target, prop) => (prop === 'innerBlockRefs' ? refs : Reflect.get(target, prop, target))
		})
	);
	const reorder = createReorderAction(harness.deps, controller);
	return { doc: harness.doc, node, reorder, announced, focused };
}

describe('reorder announcement and landing: document scope', () => {
	it('counts the siblings a fold left, not the ones the move started with', async () => {
		// Moving the heading out from between the two paragraphs joins them.
		const h = makeTop('a\n# h\nb\n');

		await h.reorder.moveReorderUnit([1], 2);

		expect(serialize(h.doc)).toBe('a\nb\n# h\n');
		expect(h.doc.children).toHaveLength(2);
		expect(h.announced).toEqual(['Moved block to position 2 of 2']);
	});

	// The keyboard nudge, the gesture that carries the caret: a drop does not focus what it
	// dropped (`reorder-action.ts`), so only this path can see the ref the caret lands on.
	it('focuses the block the move landed on after the fold above it', async () => {
		const h = makeTop('a\n# h\nb\n');

		await h.reorder.nudgeReorderUnit([1], 1);

		// Index 1 after the merge, and the ref that got there is the moved block's own.
		expect(h.focused).toEqual([1]);
	});

	it('reports the plain permutation unchanged', async () => {
		const h = makeTop('a\n\nb\n\nc\n');

		await h.reorder.moveReorderUnit([0], 2);

		expect(serialize(h.doc)).toBe('b\n\nc\n\na\n');
		expect(h.announced).toEqual(['Moved block to position 3 of 3']);
		// A drop is not a request to edit what was dropped: it focuses nothing.
		expect(h.focused).toEqual([]);
	});
});

describe('reorder announcement and landing: container scope', () => {
	it('counts the body blocks a fold left, not the pre-commit copy of them', async () => {
		const h = makeContainer('> a\n> # h\n> b\n');

		await h.reorder.moveReorderUnit([0, 1], 2);

		expect(serialize(h.doc)).toBe('> a\n> b\n> # h\n');
		expect(h.node().children).toHaveLength(2);
		expect(h.announced).toEqual(['Moved block to position 2 of 2']);
	});

	it('focuses the body block the move landed on', async () => {
		const h = makeContainer('> a\n> # h\n> b\n');

		await h.reorder.nudgeReorderUnit([0, 1], 1);

		expect(h.focused).toEqual([1]);
	});
});

// Reading mode refuses the move commands first; called anyway, the action must announce no move.
// Miss-analysis: every announcement case wrote; none asked the action about a refused commit.
describe('a reorder the commit refuses', () => {
	it.each([
		['document', () => makeTop('a\n\nb\n', 'reading'), [0]],
		['container', () => makeContainer('> a\n>\n> b\n', 'reading'), [0, 0]]
	] as const)('at %s scope resolves false and announces nothing', async (_, make, from) => {
		const h = make();
		const before = serialize(h.doc);

		const moved = await h.reorder.moveReorderUnit([...from], 1);

		expect(h.announced).toEqual([]);
		expect(moved).toBe(false);
		expect(serialize(h.doc)).toBe(before);
		expect(takeDevWarns().map((w) => w.tag)).toEqual([READING_WRITE_TAG]);
	});
});

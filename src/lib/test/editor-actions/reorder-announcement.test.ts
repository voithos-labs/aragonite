import { describe, it, expect } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createReorderAction } from '$lib/editor-actions/reorder-action';
import { createBlockListState } from '$lib/reactivity/block-list-state.svelte';
import { registerBlockListState } from '$lib/reactivity/state-registry';
import { movedBlockToPosition } from '$lib/a11y-strings';
import { mockRef, makeEditorActionsDeps } from '$lib/test/harness/editor-actions';
import type { BlockComponent } from '$lib/block-component';

// What a reorder REPORTS, at both scopes: the a11y announcement and the caret landing. A move can
// invalidate a join, and the fold that settles it changes both the destination and the sibling
// count — neither of which the pre-commit node can answer, since the commit copies it away.
// Miss-analysis: onReorder had no test at any scope, so the container arm's stale total shipped;
// the landing was pinned at the primitive alone, never at the door that spends it.

/**
 * Every slot answers, and each records the index it was asked for. A fold's change carries
 * `idMap: {0:0}`, so the array itself holds `undefined` where a mounted editor holds a
 * component — this models the mounted document rather than the headless splice.
 */
function refsAnsweringEverySlot(
	slots: (BlockComponent | undefined)[],
	focused: number[]
): (BlockComponent | undefined)[] {
	return new Proxy(slots, {
		get(target, prop, receiver) {
			if (typeof prop === 'string' && /^\d+$/.test(prop)) {
				const index = Number(prop);
				return mockRef({ focus: () => focused.push(index) });
			}
			return Reflect.get(target, prop, receiver);
		}
	});
}

function makeTop(source: string) {
	const harness = makeEditorActionsDeps(parse(source));
	const focused: number[] = [];
	const refs = refsAnsweringEverySlot(harness.getBlockRefs(), focused);
	const deps = new Proxy(harness.deps, {
		get: (target, prop) => (prop === 'blockRefs' ? refs : Reflect.get(target, prop, target))
	});
	const announced: string[] = [];
	const reorder = createReorderAction(deps, createUndoController(harness.deps), (to, total) =>
		announced.push(movedBlockToPosition(to + 1, total))
	);
	return { doc: harness.doc, reorder, announced, focused };
}

function makeContainer(source: string) {
	const harness = makeEditorActionsDeps(parse(source));
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
	const announced: string[] = [];
	const reorder = createReorderAction(
		harness.deps,
		createUndoController(harness.deps),
		(to, total) => announced.push(movedBlockToPosition(to + 1, total))
	);
	return { doc: harness.doc, node, reorder, announced, focused };
}

describe('reorder announcement and landing — document scope', () => {
	it('counts the siblings a fold left, not the ones the move started with', async () => {
		// Moving the heading out from between the two paragraphs joins them.
		const h = makeTop('a\n# h\nb\n');

		await h.reorder.moveReorderUnit([1], 2);

		expect(serialize(h.doc)).toBe('a\nb\n# h\n');
		expect(h.doc.children).toHaveLength(2);
		expect(h.announced).toEqual(['Moved block to position 2 of 2']);
	});

	it('focuses the block the move landed on after the fold above it', async () => {
		const h = makeTop('a\n# h\nb\n');

		await h.reorder.moveReorderUnit([1], 2);

		// Slot 1 after the fold, and the ref that got there is the moved block's own.
		expect(h.focused).toEqual([1]);
	});

	it('reports the plain permutation unchanged', async () => {
		const h = makeTop('a\n\nb\n\nc\n');

		await h.reorder.moveReorderUnit([0], 2);

		expect(serialize(h.doc)).toBe('b\n\nc\n\na\n');
		expect(h.announced).toEqual(['Moved block to position 3 of 3']);
		expect(h.focused).toEqual([2]);
	});
});

describe('reorder announcement and landing — container scope', () => {
	it('counts the body blocks a fold left, not the pre-commit copy of them', async () => {
		const h = makeContainer('> a\n> # h\n> b\n');

		await h.reorder.moveReorderUnit([0, 1], 2);

		expect(serialize(h.doc)).toBe('> a\n> b\n> # h\n');
		expect(h.node().children).toHaveLength(2);
		expect(h.announced).toEqual(['Moved block to position 2 of 2']);
	});

	it('focuses the body block the move landed on', async () => {
		const h = makeContainer('> a\n> # h\n> b\n');

		await h.reorder.moveReorderUnit([0, 1], 2);

		expect(h.focused).toEqual([1]);
	});
});

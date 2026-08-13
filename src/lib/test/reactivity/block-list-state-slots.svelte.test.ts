// @vitest-environment jsdom
//
// Regression #48/#62. Miss: the slot-lifetime fixtures hand-rolled a $state scope and
// published/unpublished in separate flushes, so neither the real storage nor the commit
// republish overlapping a teardown — the ordering the strand needs — was ever compiled in.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import {
	createBlockListState,
	type BlockListState
} from '../../reactivity/block-list-state.svelte';
import { publishRefSlot } from '../../reactivity/publish-ref.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import type { CstNode } from '../../core/nodes';

function makeContainer(): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' }],
		innerPrefix: '',
		innerSuffix: ''
	};
}

/** A real container scope, so the storage under test is the one the editor mounts. */
function mountScope(): { state: BlockListState; stop: () => void } {
	let state!: BlockListState;
	const stop = $effect.root(() => {
		state = createBlockListState(() => makeContainer());
	});
	flushSync();
	return { state, stop };
}

/** A scope with one published child, plus the switch that tears that mount down. */
function mountScopeWithChild(): { state: BlockListState; unmount: () => void; stop: () => void } {
	let state!: BlockListState;
	let mounted = $state(true);
	const node = makeContainer();
	const stop = $effect.root(() => {
		state = createBlockListState(() => node);
		$effect(() => {
			if (!mounted) return;
			return publishRefSlot(state.refSlots, 0, stubBlockComponent());
		});
	});
	flushSync();
	return {
		state,
		unmount: () => {
			mounted = false;
		},
		stop
	};
}

describe('container scope slots', () => {
	it('cleanup empties the slot it published', () => {
		const { state, stop } = mountScope();

		const unpublish = publishRefSlot(state.refSlots, 0, stubBlockComponent());
		expect(state.refSlots.get(0)).toBeDefined();

		unpublish();
		expect(state.refSlots.get(0)).toBeUndefined();
		stop();
	});

	it('cleanup declines a slot a successor re-published', () => {
		const { state, stop } = mountScope();
		const unpublishFirst = publishRefSlot(state.refSlots, 0, stubBlockComponent());
		publishRefSlot(state.refSlots, 0, stubBlockComponent());
		const successor = state.refSlots.get(0);

		unpublishFirst();
		expect(state.refSlots.get(0)).toBe(successor);
		stop();
	});

	it('empties the slot when a commit republish and the teardown share one flush', () => {
		const { state, unmount, stop } = mountScopeWithChild();
		expect(state.innerBlockRefs[0]).toBeDefined();

		// The commit ceremony's shape (publishScopeView): a copy taken before the flush is
		// written back to the scope, and the same flush tears the child mount down. Svelte
		// pins destroy-time reads to pre-flush values, so a replaced array would take the
		// teardown's clear with it and leave the live array holding a dead ref.
		state.innerBlockRefs = [...state.innerBlockRefs];
		unmount();
		flushSync();

		expect(state.innerBlockRefs[0]).toBeUndefined();
		stop();
	});

	it('keeps the scope addressable by one array identity across a republish', () => {
		const { state, stop } = mountScopeWithChild();
		const before = state.innerBlockRefs;

		state.innerBlockRefs = [undefined, undefined];

		expect(state.innerBlockRefs).toBe(before);
		expect(state.innerBlockRefs).toHaveLength(2);
		stop();
	});
});

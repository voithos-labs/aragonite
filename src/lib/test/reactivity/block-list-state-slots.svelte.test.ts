// @vitest-environment jsdom
//
// Regression #48 and #62. Miss: the fixtures for a ref's lifetime built their own `$state`
// block list and wrote and cleared it in separate flushes, so neither the real storage nor a
// commit's rewrite overlapping a teardown, which is the order that strands a ref, ever ran.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import {
	createBlockListState,
	type BlockListState
} from '../../reactivity/block-list-state.svelte';
import { publishRefSlot, replaceRefs } from '../../reactivity/publish-ref.svelte';
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

/** A real container's block list, so the storage under test is the one the editor mounts. */
function mountScope(): { state: BlockListState; stop: () => void } {
	let state!: BlockListState;
	const stop = $effect.root(() => {
		state = createBlockListState(() => makeContainer());
	});
	flushSync();
	return { state, stop };
}

/** A block list with one child ref written, plus the switch that tears that mount down. */
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

		// What a commit does (`publishScopeView`): a copy taken before the flush is written back
		// to the list, and the same flush tears the child mount down. Svelte holds a teardown's
		// reads to pre-flush values, so a replaced array would take the teardown's clear with it
		// and leave the live array holding a dead ref.
		replaceRefs(state.innerBlockRefs, [...state.innerBlockRefs]);
		unmount();
		flushSync();

		expect(state.innerBlockRefs[0]).toBeUndefined();
		stop();
	});

	it('a whole-contents republish resizes the one array rather than swapping it', () => {
		const { state, stop } = mountScopeWithChild();
		const before = state.innerBlockRefs;

		replaceRefs(state.innerBlockRefs, [undefined, undefined]);

		expect(state.innerBlockRefs).toBe(before);
		expect(state.innerBlockRefs).toHaveLength(2);
		stop();
	});
});

/** Checked by `npm run check`: making the property settable again leaves the directive
 *  unused, which fails the type check. Never called. */
export function compileTimePins(state: BlockListState): void {
	// @ts-expect-error the array's identity is the list; contents are written by replaceRefs
	state.innerBlockRefs = [];
}

// @vitest-environment jsdom
// Miss-analysis (GH #48, #62): fixtures used their own list, so no rewrite raced a teardown.
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import {
	createBlockListState,
	type BlockListState
} from '../../block-lists/block-list-state.svelte';
import { publishRefSlot, replaceRefs } from '../../block-lists/child-refs';
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

		// A commit writes back a pre-flush copy while the same flush tears the child down; a
		// replaced array would lose the teardown's clear and keep a dead ref.
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

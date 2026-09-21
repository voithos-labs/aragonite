// @vitest-environment jsdom
//
// Regression #48. Miss: the suite for two components registering the same node faked teardown
// by nulling its own array, so the cleanup's identity check never ran against the storage a
// real block list writes into.
import { describe, it, expect } from 'vitest';
import { DEV } from 'esm-env';
import { flushSync, tick } from 'svelte';
import {
	createBlockListState,
	type BlockListState
} from '../../reactivity/block-list-state.svelte';
import { stubBlockComponent } from '../../testing/headless-actions';
import type { CstNode } from '../../core/nodes';
import { publishRefSlot } from '../../reactivity/publish-ref.svelte';
import { takeDevWarns } from '../support/warn-gate';

function makeNode(): CstNode {
	return {
		kind: 'blockquote',
		leadingTrivia: '',
		raw: '',
		metadata: { quoteDepth: 1 },
		// One child: the list truncates its refs to the child count, so a childless node could not
		// hold the ref this test needs.
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'a\n' }],
		innerPrefix: '',
		innerSuffix: ''
	};
}

/** A real block list over `node`, so registration goes through the factory the editor uses. */
function mountScope(node: CstNode): { state: BlockListState; stop: () => void } {
	let state!: BlockListState;
	const stop = $effect.root(() => {
		state = createBlockListState(() => node);
	});
	flushSync();
	return { state, stop };
}

function publishChild(state: BlockListState): () => void {
	return publishRefSlot(state.refSlots, 0, stubBlockComponent());
}

describe('contested-claim suppression over real scopes', () => {
	it('stays silent when the loser was torn down through publish cleanup', async () => {
		const node = makeNode();
		const loser = mountScope(node);
		const unpublish = publishChild(loser.state);

		const winner = mountScope(node);
		publishChild(winner.state);
		unpublish();

		await tick();
		expect(takeDevWarns()).toEqual([]);
		loser.stop();
		winner.stop();
	});

	it.runIf(DEV)('still warns when the loser keeps a live publish', async () => {
		const node = makeNode();
		const loser = mountScope(node);
		const winner = mountScope(node);
		publishChild(loser.state);
		publishChild(winner.state);

		await tick();
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('two live components');
		loser.stop();
		winner.stop();
	});
});

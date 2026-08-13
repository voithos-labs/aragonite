// @vitest-environment jsdom
//
// Regression #48. Miss: the contested-claim suite faked teardown by nulling a hand-rolled
// array, so cleanup's identity check never ran against the storage a real scope publishes into.
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
		children: []
	};
}

/** A real scope over `node`, so registration goes through the factory the editor mounts. */
function mountScope(node: CstNode): BlockListState {
	let state!: BlockListState;
	$effect.root(() => {
		state = createBlockListState(() => node);
	});
	flushSync();
	return state;
}

function publishChild(state: BlockListState): () => void {
	return publishRefSlot(state.refSlots, 0, stubBlockComponent());
}

describe('contested-claim suppression over real scopes', () => {
	it('stays silent when the loser was torn down through publish cleanup', async () => {
		const node = makeNode();
		const loser = mountScope(node);
		const unpublish = publishChild(loser);

		const winner = mountScope(node);
		publishChild(winner);
		unpublish();

		await tick();
		expect(takeDevWarns()).toEqual([]);
	});

	it('still warns when the loser keeps a live publish', async () => {
		if (!DEV) return;
		const node = makeNode();
		publishChild(mountScope(node));
		publishChild(mountScope(node));

		await tick();
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toContain('two live components');
	});
});

// @vitest-environment jsdom
//
// Regression #48. Miss: the contested-claim suite faked teardown by nulling a plain
// array, so cleanup's identity check never ran against the proxied read a real scope does.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEV } from 'esm-env';
import { tick } from 'svelte';
import { registerBlockListState } from '../../reactivity/state-registry';
import type { BlockListState } from '../../reactivity/block-list-state.svelte';
import type { CstNode } from '../../core/nodes';
import { publishRefSlot, refSlotsOver } from '../../reactivity/publish-ref.svelte';

function makeStateBacked(): BlockListState {
	let innerBlockRefs = $state<BlockListState['innerBlockRefs']>([]);
	return {
		innerBlockIds: ['a'],
		get innerBlockRefs() {
			return innerBlockRefs;
		},
		set innerBlockRefs(value) {
			innerBlockRefs = value;
		},
		refSlots: refSlotsOver(() => innerBlockRefs)
	};
}

function publishContainerRef(state: BlockListState): () => void {
	return publishRefSlot(state.refSlots, 0, {
		focus() {}
	} as BlockListState['innerBlockRefs'][number] & object);
}

describe('contested-claim suppression over $state-backed scopes', () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		warnSpy.mockRestore();
	});

	it('stays silent when the loser was torn down through publish cleanup', async () => {
		const node = { kind: 'list', leadingTrivia: '', raw: '' } as CstNode;
		const loser = makeStateBacked();
		const unpublish = publishContainerRef(loser);
		registerBlockListState(node, loser);

		const winner = makeStateBacked();
		publishContainerRef(winner);
		registerBlockListState(node, winner);
		unpublish();

		await tick();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('still warns when the loser keeps a live publish', async () => {
		if (!DEV) return;
		const node = { kind: 'list', leadingTrivia: '', raw: '' } as CstNode;
		const loser = makeStateBacked();
		publishContainerRef(loser);
		registerBlockListState(node, loser);

		const winner = makeStateBacked();
		publishContainerRef(winner);
		registerBlockListState(node, winner);

		await tick();
		expect(warnSpy).toHaveBeenCalledOnce();
		expect(warnSpy.mock.calls[0][0]).toContain('two live components');
	});
});

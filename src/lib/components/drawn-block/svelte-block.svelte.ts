/**
 * `svelteBlock`: a block type's `draw` from a Svelte component, which places the editor's elements
 * with `<Slot of="source" />` (or `children`, `title`). It renders synchronously, so a slot is in
 * place by the time `draw` returns.
 */
import { flushSync, mount, unmount, type Component } from 'svelte';
import type { Block } from '../../schema/doc-view';
import type { DrawContext, Drawn } from '../../schema/drawing';
import DrawnSlot, { SLOT_CONTEXT } from './DrawnSlot.svelte';

export interface SvelteBlockProps<D = never, C extends DrawContext = DrawContext> {
	block: Block<D>;
	ctx: C;
	/** Places one of the editor's elements: `<Slot of="source" />`. */
	Slot: typeof DrawnSlot;
}

export function svelteBlock<D = never, C extends DrawContext = DrawContext>(
	Component: Component<SvelteBlockProps<D, C>>
): (block: Block<D>, ctx: C) => Drawn<D, C> {
	return (block, ctx) => {
		const dom = document.createElement('div');
		// Raw: a block and its context are read whole, never deep-tracked.
		let current = $state.raw({ block, ctx });
		const instance = mount(Component, {
			target: dom,
			props: {
				get block() {
					return current.block;
				},
				get ctx() {
					return current.ctx;
				},
				Slot: DrawnSlot
			},
			context: new Map([[SLOT_CONTEXT, () => current.ctx]])
		});
		flushSync();
		return {
			dom,
			update(next, nextCtx) {
				current = { block: next, ctx: nextCtx };
				flushSync();
			},
			destroy: () => void unmount(instance)
		};
	};
}

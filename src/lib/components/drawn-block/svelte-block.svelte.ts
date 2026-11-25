/**
 * `svelteBlock`: a block type's `draw` from a Svelte component, which places the editor's elements
 * with `<Slot of="source" />` (or `children`) and adds to what it draws with `useDrawn`.
 * It renders synchronously, so a slot is in place by the time `draw` returns.
 */
import { flushSync, getContext, mount, unmount, type Component } from 'svelte';
import type { Block } from '../../schema/doc-view';
import type { DrawContext, Drawn } from '../../schema/drawing';
import DrawnSlot, { SLOT_CONTEXT } from './DrawnSlot.svelte';

export interface SvelteBlockProps<D = never, C extends DrawContext = DrawContext> {
	block: Block<D>;
	ctx: C;
	/** Places one of the editor's elements: `<Slot of="source" />`. */
	Slot: typeof DrawnSlot;
}

export interface SvelteBlockOptions {
	/** Classes for the block's element. */
	className?: string;
	/** Context the component reads with `getContext`, as `mount` takes it: state made in
	 *  `contributes`, say, which is one editor's. */
	context?: Map<unknown, unknown>;
}

/** What a component adds to its block's drawing, read each time the editor needs it. */
type DrawnParts<H = unknown> = Pick<
	Drawn<never, DrawContext, H>,
	'focus' | 'keep' | 'caret' | 'save' | 'handle'
>;

const DRAWN_CONTEXT = Symbol('drawn-parts');

export function svelteBlock<D = never, C extends DrawContext = DrawContext, H = unknown>(
	Component: Component<SvelteBlockProps<D, C>>,
	{ className, context }: SvelteBlockOptions = {}
): (block: Block<D>, ctx: C) => Drawn<D, C, H> {
	return (block, ctx) => {
		const dom = document.createElement('div');
		if (className) dom.className = className;
		// Raw: a block and its context are read whole, never deep-tracked.
		let current = $state.raw({ block, ctx });
		const declared = { parts: (): DrawnParts<H> => ({}) };
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
			context: new Map<unknown, unknown>([
				...(context ?? []),
				[SLOT_CONTEXT, () => current.ctx],
				[DRAWN_CONTEXT, declared]
			])
		});
		flushSync();
		return {
			dom,
			update(next, nextCtx) {
				current = { block: next, ctx: nextCtx };
				flushSync();
			},
			destroy: () => void unmount(instance),
			get focus() {
				return declared.parts().focus;
			},
			get keep() {
				return declared.parts().keep;
			},
			get caret() {
				return declared.parts().caret;
			},
			get save() {
				return declared.parts().save;
			},
			get handle() {
				return declared.parts().handle;
			}
		};
	};
}

/** Called while a `svelteBlock` component initialises: `parts` says what it adds to the drawing,
 *  its block's `focus`, `keep`, `caret`, `save` or `handle`. */
export function useDrawn<H = unknown>(parts: () => DrawnParts<H>): void {
	const declared = getContext<{ parts: () => DrawnParts<H> } | undefined>(DRAWN_CONTEXT);
	if (!declared) throw new Error('useDrawn runs only inside a svelteBlock component');
	declared.parts = parts;
}

/**
 * `vueBlock`: a block type's `draw` from a Vue component, which places the editor's elements with
 * `<Slot of="source" />` (or `children`, `title`). It patches synchronously, so a slot is in place
 * by the time `draw` returns.
 */

import {
	defineComponent,
	h,
	inject,
	provide,
	type App,
	type Component,
	type InjectionKey,
	type PropType
} from 'vue';
import type { Block, DrawContext, Drawn } from '@voithos-labs/aragonite/plugin';
import { createViewRoot } from './view-root.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface BlockProps<D = never, C extends DrawContext = DrawContext> {
	block: Block<D>;
	ctx: C;
	/** Places one of the editor's elements: `<Slot of="source" />`. */
	Slot: typeof Slot;
}

export interface VueBlockOptions {
	/** Classes for the block's element. */
	className?: string;
	/** Renders inside this app's context: its `provide`s, global components and plugins. */
	app?: App;
}

export function vueBlock<D = never, C extends DrawContext = DrawContext>(
	component: Component,
	{ className, app }: VueBlockOptions = {}
): (block: Block<D>, ctx: C) => Drawn<D, C> {
	return (block, ctx) => {
		const dom = document.createElement('div');
		if (className) dom.className = className;
		const root = createViewRoot(dom, app);
		// A context of its own per render: its fields are getters Vue can't watch, so a computed
		// reading `ctx.typed` would never run again on the same object.
		const render = (next: Block<D>, nextCtx: C) =>
			root.render(
				h(Provide, { ctx: nextCtx }, () =>
					h(component, { block: next, ctx: Object.create(nextCtx) as C, Slot })
				)
			);
		render(block, ctx);
		return { dom, update: render, destroy: root.unmount };
	};
}

// ── Internal ────────────────────────────────────────────────────────────────

type SlotName = 'source' | 'children' | 'title';

const SLOT_CONTEXT: InjectionKey<() => DrawContext> = Symbol('vue-block-slot');

const Provide = defineComponent({
	props: { ctx: { type: Object as PropType<DrawContext>, required: true } },
	setup(props, { slots }) {
		provide(SLOT_CONTEXT, () => props.ctx);
		return () => slots.default?.();
	}
});

const Slot = defineComponent({
	props: { of: { type: String as PropType<SlotName>, required: true } },
	setup(props) {
		const ctx = inject(SLOT_CONTEXT, null);
		if (!ctx) throw new Error('<Slot> renders only inside a vueBlock component');
		return () => {
			const element = (ctx() as unknown as Partial<Record<SlotName, HTMLElement | null>>)[props.of];
			if (!element) return null;
			return h('div', {
				style: 'display: contents',
				// A move would blur the text if it already sits here.
				ref: (host: unknown) => {
					if (host instanceof HTMLElement && element.parentNode !== host) host.append(element);
				}
			});
		};
	}
});

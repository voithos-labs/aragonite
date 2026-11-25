/**
 * `vueBlock`: a block type's `draw` from a Vue component, which places the editor's elements with
 * `<Slot of="source" />` (or `children`) and adds to what it draws with `useDrawn`. It
 * patches synchronously, so a slot is in place by the time `draw` returns.
 */

import {
	createApp,
	defineComponent,
	h,
	inject,
	provide,
	type App,
	type AppContext,
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

export function vueBlock<D = never, C extends DrawContext = DrawContext, H = unknown>(
	component: Component,
	{ className, app }: VueBlockOptions = {}
): (block: Block<D>, ctx: C) => Drawn<D, C, H> {
	const context = withSlot(app);
	return (block, ctx) => {
		const dom = document.createElement('div');
		if (className) dom.className = className;
		const root = createViewRoot(dom, context);
		const declared: Declared<H> = { parts: () => ({}) };
		// A context of its own per render: its fields are getters Vue can't watch, so a computed
		// reading `ctx.typed` would never run again on the same object.
		const render = (next: Block<D>, nextCtx: C) =>
			root.render(
				h(Provide, { ctx: nextCtx, declared }, () =>
					h(component, { block: next, ctx: Object.create(nextCtx) as C, Slot })
				)
			);
		render(block, ctx);
		return {
			dom,
			update: render,
			destroy: root.unmount,
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

/** Called in a `vueBlock` component's `setup`: `parts` says what it adds to the drawing, its
 *  block's `focus`, `keep`, `caret`, `save` or `handle`, read each time the editor needs it (a
 *  template ref, say). */
export function useDrawn<H = unknown>(parts: () => DrawnParts<H>): void {
	const declared = inject(DRAWN_CONTEXT, null) as Declared<H> | null;
	if (!declared) throw new Error('useDrawn runs only inside a vueBlock component');
	declared.parts = parts;
}

// ── Internal ────────────────────────────────────────────────────────────────

type SlotName = 'source' | 'children';
type DrawnParts<H = unknown> = Pick<
	Drawn<never, DrawContext, H>,
	'focus' | 'keep' | 'caret' | 'save' | 'handle'
>;
type Declared<H = unknown> = { parts: () => DrawnParts<H> };

// Named, never indexed: the title row's element is on the context too, and moving it would take the
// row out of the block list's windowing and focus walk.
const slotted = (ctx: DrawContext, of: SlotName): HTMLElement | null =>
	of === 'source' || of === 'children'
		? ((ctx as unknown as Partial<Record<SlotName, HTMLElement>>)[of] ?? null)
		: null;

const SLOT_CONTEXT: InjectionKey<() => DrawContext> = Symbol('vue-block-slot');
const DRAWN_CONTEXT: InjectionKey<Declared> = Symbol('vue-block-drawn');

const Provide = defineComponent({
	props: {
		ctx: { type: Object as PropType<DrawContext>, required: true },
		declared: { type: Object as PropType<Declared>, required: true }
	},
	setup(props, { slots }) {
		provide(SLOT_CONTEXT, () => props.ctx);
		provide(DRAWN_CONTEXT, props.declared);
		return () => slots.default?.();
	}
});

const Slot = defineComponent({
	props: { of: { type: String as PropType<SlotName>, required: true } },
	setup(props) {
		const ctx = inject(SLOT_CONTEXT, null);
		if (!ctx) throw new Error('<Slot> renders only inside a vueBlock component');
		return () => {
			const element = slotted(ctx(), props.of);
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

// A template that doesn't bind `<Slot>` to the prop looks it up by name: an options-API component's
// does, and so does a typed `defineProps` built by a compiler older than Vue 3.5.22.
function withSlot(app: App | undefined): AppContext {
	const base = (app ?? createApp({}))._context;
	return { ...base, components: Object.assign(Object.create(base.components), { Slot }) };
}

/**
 * A plugin block drawn by a Vue component. The component renders into the element the editor made
 * for the block through Vue's `render`, which patches synchronously, so an element it hands over
 * (`LeafContent`, `BlockChildren`) is in place by the time the editor's `mount` or `update` returns.
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
import {
	defineBlockView,
	type BlockView,
	type BlockViewContext,
	type BlockViewSpec,
	type BlockViewState,
	type ContainerSurface,
	type ContainerViewContext,
	type ContainerViewSpec,
	type LeafSurface,
	type LeafViewContext,
	type LeafViewSpec,
	type RenderPrimarySurface,
	type RenderPrimaryViewContext,
	type RenderPrimaryViewSpec
} from '@voithos-labs/aragonite/plugin';
import { createViewRoot } from './view-root.js';

// ── Public API ──────────────────────────────────────────────────────────────

// A component's `ctx` leaves out the calls that hand the editor an element, which `LeafContent`,
// `BlockChildren` and the helper itself make.
interface Surfaces {
	leaf: {
		spec: LeafViewSpec;
		ctx: BlockViewContext & { readonly leaf: Omit<LeafSurface, 'attach'> };
	};
	'render-primary': {
		spec: RenderPrimaryViewSpec;
		ctx: BlockViewContext & {
			readonly leaf: Omit<RenderPrimarySurface, 'attach' | 'attachRendered'>;
		};
	};
	container: {
		spec: ContainerViewSpec;
		ctx: BlockViewContext & { readonly container: Omit<ContainerSurface, 'mountChildren'> };
	};
}

type MountContext = LeafViewContext | RenderPrimaryViewContext | ContainerViewContext;

/** What the editor builds into a framework-drawn block: editable text, shown always or behind a
 *  rendered view until a click, or child blocks. */
export type FrameworkSurface = keyof Surfaces;

/** What the block's component gets as props: the block's state, and the editor calls for its surface. */
export interface BlockViewProps<S extends FrameworkSurface = 'leaf'> {
	state: BlockViewState;
	ctx: Surfaces[S]['ctx'];
	/** A render-primary block's text as typed, before it commits, for a live preview; null while
	 *  folded, before the first edit, and on the other surfaces. */
	draft: string | null;
}

export type VueBlockViewOptions<S extends FrameworkSurface> = Omit<Surfaces[S]['spec'], 'mount'> & {
	/** Classes for the element the editor made for the block, which it measures as the block. */
	className?: string;
	/** Hears each change to the shown text, once, never mid-composition; leaf surfaces only. */
	afterInput?: S extends 'container' ? never : (text: string, ctx: Surfaces[S]['ctx']) => void;
	/** The host app, whose `provide`s, global components and plugins the block then sees; without
	 *  it the block renders apart from any app. */
	app?: App;
};

/** A block view drawn by `component`; a render-primary block's whole element opens its text. */
export function vueBlockView<S extends FrameworkSurface>(
	component: Component,
	options: { surface: S } & VueBlockViewOptions<S>
): BlockView {
	const { className, afterInput, app, ...spec } = options;
	return defineBlockView({
		...spec,
		mount(target: HTMLElement, ctx: MountContext) {
			if (className) target.className = className;
			if (spec.surface === 'render-primary') {
				(ctx as RenderPrimaryViewContext).leaf.attachRendered(target);
			}
			const handOver = handOverFor(ctx);
			// One root component per mount, so each `render` patches the same tree.
			const Root = defineComponent({
				props: {
					state: { type: Object as PropType<BlockViewState>, required: true },
					draft: { type: String as PropType<string | null>, default: null }
				},
				setup(props) {
					provide(HAND_OVER, handOver);
					return () => h(component, { state: props.state, ctx, draft: props.draft });
				}
			});
			const root = createViewRoot(target, app);
			let draft: string | null = null;
			const draw = (state: BlockViewState, typed = state.revealed ? draft : null) => {
				draft = typed;
				root.render(h(Root, { state, draft }));
			};
			draw(ctx.state());
			return {
				update: draw,
				afterInput(text: string) {
					if (spec.surface === 'render-primary') draw(ctx.state(), text);
					afterInput?.(text, ctx as never);
				},
				destroy() {
					root.unmount();
				}
			};
		}
	} as BlockViewSpec);
}

const contentProps = {
	as: { type: String as PropType<'div' | 'span' | 'p' | 'pre'>, default: 'div' }
};

/** The element the editor edits the block's text in. It renders empty: the text is the editor's. */
export const LeafContent = defineComponent({
	name: 'LeafContent',
	props: contentProps,
	setup(props) {
		const handOver = useHandOver('LeafContent');
		return () => h(props.as, { ref: handOver.attach });
	}
});

/** The element the editor mounts the block's children into. It renders empty: chrome goes beside it. */
export const BlockChildren = defineComponent({
	name: 'BlockChildren',
	props: contentProps,
	setup(props) {
		const handOver = useHandOver('BlockChildren');
		return () => h(props.as, { ref: handOver.mountChildren });
	}
});

// ── Internal ────────────────────────────────────────────────────────────────

/** One per mount, holding the mount's `ctx`. Vue calls a function ref again on each re-render; the
 *  editor ignores an element it already has, and one handed over after `destroy`. */
interface HandOver {
	attach(el: unknown): void;
	mountChildren(el: unknown): void;
}

const HAND_OVER: InjectionKey<HandOver> = Symbol('aragonite block view');

function handOverFor(ctx: MountContext): HandOver {
	return {
		attach(el) {
			if (!('leaf' in ctx)) throw new Error('<LeafContent> is for a leaf or render-primary block');
			ctx.leaf.attach(el as HTMLElement | null);
		},
		mountChildren(el) {
			if (!el) return;
			if (!('container' in ctx)) throw new Error('<BlockChildren> is for a container block');
			ctx.container.mountChildren(el as HTMLElement);
		}
	};
}

function useHandOver(name: string): HandOver {
	const handOver = inject(HAND_OVER, null);
	if (!handOver) throw new Error(`<${name}> renders only inside a vueBlockView component`);
	return handOver;
}

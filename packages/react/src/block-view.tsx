'use client';
/**
 * A plugin block drawn by a React component. The component renders into the element the editor
 * made for the block, synchronously, so an element it hands over (`<LeafContent>`,
 * `<BlockChildren>`) is in place by the time the editor's `mount` or `update` call returns.
 */

import {
	createContext,
	useContext,
	type ComponentType,
	type HTMLAttributes,
	type ReactNode
} from 'react';
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

/** What the block's component gets: the block's state, and the editor calls for its surface. */
export interface BlockViewProps<S extends FrameworkSurface = 'leaf'> {
	state: BlockViewState;
	ctx: Surfaces[S]['ctx'];
	/** A render-primary block's text as typed, before it commits, for a live preview; null while
	 *  folded, before the first edit, and on the other surfaces. */
	draft: string | null;
}

export type ReactBlockViewOptions<S extends FrameworkSurface> = Omit<
	Surfaces[S]['spec'],
	'mount'
> & {
	/** Classes for the element the editor made for the block, which it measures as the block. */
	className?: string;
	/** Hears each change to the shown text, once, never mid-composition; leaf surfaces only. */
	afterInput?: S extends 'container' ? never : (text: string, ctx: Surfaces[S]['ctx']) => void;
	/** Wraps the component, for providers: the block renders in a React root of its own, which
	 *  a provider in the host app doesn't reach. */
	wrap?: (block: ReactNode) => ReactNode;
};

/** A block view drawn by `Component`; a render-primary block's whole element opens its text. */
export function reactBlockView<S extends FrameworkSurface>(
	Component: ComponentType<BlockViewProps<S>>,
	options: { surface: S } & ReactBlockViewOptions<S>
): BlockView {
	const { className, afterInput, wrap, ...spec } = options;
	return defineBlockView({
		...spec,
		mount(target: HTMLElement, ctx: MountContext) {
			if (className) target.className = className;
			if (spec.surface === 'render-primary') {
				(ctx as RenderPrimaryViewContext).leaf.attachRendered(target);
			}
			const handOver = handOverFor(ctx);
			const root = createViewRoot(target, wrap);
			let draft: string | null = null;
			const draw = (state: BlockViewState, typed = state.revealed ? draft : null) => {
				draft = typed;
				const block = (
					<HandOverContext.Provider value={handOver}>
						<Component state={state} ctx={ctx as Surfaces[S]['ctx']} draft={draft} />
					</HandOverContext.Provider>
				);
				root.render(block);
			};
			draw(ctx.state());
			return {
				update: draw,
				afterInput(text: string) {
					if (spec.surface === 'render-primary') draw(ctx.state(), text);
					afterInput?.(text, ctx as never);
				},
				destroy: root.unmount
			};
		}
	} as BlockViewSpec);
}

type ContentProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
	as?: 'div' | 'span' | 'p' | 'pre';
};

/** The element the editor edits the block's text in. It renders empty: the text is the editor's. */
export function LeafContent({ as: Tag = 'div', ...attributes }: ContentProps) {
	return <Tag {...attributes} ref={useHandOver('LeafContent').attach} />;
}

/** The element the editor mounts the block's children into. It renders empty: chrome goes beside it. */
export function BlockChildren({ as: Tag = 'div', ...attributes }: ContentProps) {
	return <Tag {...attributes} ref={useHandOver('BlockChildren').mountChildren} />;
}

// ── Internal ────────────────────────────────────────────────────────────────

/** One per mount, so each ref callback keeps its identity across renders: a new one would be
 *  called with null first, and the editor empties an element handed back to it. */
interface HandOver {
	attach(el: HTMLElement | null): void;
	mountChildren(el: HTMLElement | null): void;
}

const HandOverContext = createContext<HandOver | null>(null);

function handOverFor(ctx: MountContext): HandOver {
	return {
		attach(el) {
			if (!('leaf' in ctx)) throw new Error('<LeafContent> is for a leaf or render-primary block');
			ctx.leaf.attach(el);
		},
		mountChildren(el) {
			if (!el) return;
			if (!('container' in ctx)) throw new Error('<BlockChildren> is for a container block');
			ctx.container.mountChildren(el);
		}
	};
}

function useHandOver(name: string): HandOver {
	const handOver = useContext(HandOverContext);
	if (!handOver) throw new Error(`<${name}> renders only inside a reactBlockView component`);
	return handOver;
}

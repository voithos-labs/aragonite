'use client';
/**
 * `reactBlock`: a block type's `draw` from a React component, which places the editor's elements
 * with `<Slot of="source" />` (or `children`, `title`) and adds to what it draws with `useDrawn`.
 * It renders synchronously, so a slot is in place by the time `draw` returns.
 */

import {
	createContext,
	useCallback,
	useContext,
	useLayoutEffect,
	type ComponentType,
	type ReactNode
} from 'react';
import type { Block, DrawContext, Drawn } from '@voithos-labs/aragonite/plugin';
import { createViewRoot } from './view-root.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface BlockProps<D = never, C extends DrawContext = DrawContext> {
	block: Block<D>;
	ctx: C;
	/** Places one of the editor's elements: `<Slot of="source" />`. */
	Slot: typeof Slot;
}

export interface ReactBlockOptions {
	/** Classes for the block's element. */
	className?: string;
	/** Wraps the component, for providers: the block renders in a React root of its own, which a
	 *  provider in the host app doesn't reach. */
	wrap?: (block: ReactNode) => ReactNode;
	/** The drawing's `depends`: what it reads of each top-level block, handed back as
	 *  `ctx.depends`. */
	depends?(block: Block): string;
}

export function reactBlock<D = never, C extends DrawContext = DrawContext>(
	Component: ComponentType<BlockProps<D, C>>,
	{ className, wrap, depends }: ReactBlockOptions = {}
): (block: Block<D>, ctx: C) => Drawn<D, C> {
	return (block, ctx) => {
		const dom = document.createElement('div');
		if (className) dom.className = className;
		const root = createViewRoot(dom, wrap);
		const declared: Declared = { parts: () => ({}) };
		const render = (next: Block<D>, nextCtx: C) =>
			root.render(
				<DrawnContext.Provider value={declared}>
					<SlotContext.Provider value={nextCtx}>
						<Component block={next} ctx={nextCtx} Slot={Slot} />
					</SlotContext.Provider>
				</DrawnContext.Provider>
			);
		render(block, ctx);
		return {
			dom,
			update: render,
			destroy: root.unmount,
			depends,
			get focus() {
				return declared.parts().focus;
			},
			get keep() {
				return declared.parts().keep;
			},
			get caret() {
				return declared.parts().caret;
			}
		};
	};
}

/** Called in a `reactBlock` component: `parts` says what it adds to the drawing, its block's
 *  `focus`, `keep` or `caret`, read each time the editor needs it (a ref's element, say). */
export function useDrawn(parts: () => DrawnParts): void {
	const declared = useContext(DrawnContext);
	if (!declared) throw new Error('useDrawn runs only inside a reactBlock component');
	// A layout effect runs inside the synchronous render, so the parts are there when `draw` returns.
	useLayoutEffect(() => {
		declared.parts = parts;
	});
}

// ── Internal ────────────────────────────────────────────────────────────────

type SlotName = 'source' | 'children' | 'title';
type DrawnParts = Pick<Drawn<never>, 'focus' | 'keep' | 'caret'>;
type Declared = { parts: () => DrawnParts };

const SlotContext = createContext<DrawContext | null>(null);
const DrawnContext = createContext<Declared | null>(null);

function Slot({ of }: { of: SlotName }) {
	const ctx = useContext(SlotContext);
	if (!ctx) throw new Error('<Slot> renders only inside a reactBlock component');
	const element = (ctx as unknown as Partial<Record<SlotName, HTMLElement | null>>)[of] ?? null;
	// One callback per element: a new one is called with null first.
	const place = useCallback(
		(host: HTMLElement | null) => {
			// A move would blur the text if it already sits here.
			if (host && element && element.parentNode !== host) host.append(element);
		},
		[element]
	);
	return element ? <div style={{ display: 'contents' }} ref={place} /> : null;
}

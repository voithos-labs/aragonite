/**
 * The one place a plugin's injected renderer (KaTeX, mermaid) is set and cached. The editor's
 * theme is part of every cache key, so a theme switch always redraws, and a missing or throwing
 * renderer comes back as the plugin's own fallback output, never an exception.
 * `docs/guide/plugin-guide.md` § Recipe: a render-primary block.
 */

import { createBoundedMemo } from './bounded-memo';
import { enrollTestReset } from './schema/registry-reset';

/** What every render call carries besides its input. `theme` is required, so no render can be
 *  drawn or cached without it. */
export interface RenderContext {
	readonly theme: string;
}

/** How a slot keys and replaces a render; the theme is joined to `key(input)` by the slot. */
export interface RendererSlotSpec<Input, Output> {
	key(input: Input): string;
	/** Shown while no renderer is set; never cached. */
	missing(input: Input): Output;
	/** Shown for a throw or a rejection, and cached like a success. */
	failed(input: Input, error: unknown): Output;
	/** Maximum cached renders, least recently used evicted first. Defaults to 256. */
	cap?: number;
}

/** A synchronous renderer's slot: set once from a plugin's setup, read from every render. */
export interface RendererSlot<Input, Output> {
	/** `null` removes the renderer. Either way the cache empties. */
	set(renderer: ((input: Input, ctx: RenderContext) => Output) | null): void;
	readonly configured: boolean;
	render(input: Input, ctx: RenderContext): Output;
}

/** The slot for a renderer that returns a promise; the promise is what gets cached, so two
 *  blocks asking for the same render share one call. */
export interface AsyncRendererSlot<Input, Output> {
	/** `null` removes the renderer. Either way the cache empties. */
	set(renderer: ((input: Input, ctx: RenderContext) => Promise<Output>) | null): void;
	readonly configured: boolean;
	render(input: Input, ctx: RenderContext): Promise<Output>;
}

const DEFAULT_CAP = 256;

// ── Public API ──────────────────────────────────────────────────────────────

/** `cloneOnRead` hands each caller its own copy of a cached value, for output holding a live
 *  DOM node, which can only sit in one place. */
export function createRendererSlot<Input, Output>(
	spec: RendererSlotSpec<Input, Output> & { cloneOnRead?(value: Output): Output }
): RendererSlot<Input, Output> {
	const cache = createSlotCache<(input: Input, ctx: RenderContext) => Output, Output>(
		spec.cap,
		spec.cloneOnRead
	);
	return {
		set: cache.set,
		get configured() {
			return cache.renderer() !== null;
		},
		render(input, ctx) {
			const renderer = cache.renderer();
			if (!renderer) return spec.missing(input);
			return cache.read(ctx.theme, spec.key(input), () => {
				try {
					return renderer(input, ctx);
				} catch (error) {
					return spec.failed(input, error);
				}
			});
		}
	};
}

export function createAsyncRendererSlot<Input, Output>(
	spec: RendererSlotSpec<Input, Output>
): AsyncRendererSlot<Input, Output> {
	const cache = createSlotCache<
		(input: Input, ctx: RenderContext) => Promise<Output>,
		Promise<Output>
	>(spec.cap);
	return {
		set: cache.set,
		get configured() {
			return cache.renderer() !== null;
		},
		render(input, ctx) {
			const renderer = cache.renderer();
			if (!renderer) return Promise.resolve(spec.missing(input));
			return cache.read(ctx.theme, spec.key(input), () => {
				let pending: Promise<Output>;
				try {
					pending = Promise.resolve(renderer(input, ctx));
				} catch (error) {
					pending = Promise.reject(error);
				}
				return pending.catch((error: unknown) => spec.failed(input, error));
			});
		}
	};
}

/** The typed source in the code font, red, with `message` on hover: what a view drawn by a
 *  renderer shows in its place. Styled inline, since it can land where no plugin sheet loads. */
export function renderSourceFallback(source: string, message: string): HTMLElement {
	const span = document.createElement('span');
	span.textContent = source;
	span.title = message;
	span.style.color = 'var(--color-error, #d03025)';
	span.style.fontFamily = 'var(--font-code, ui-monospace, monospace)';
	span.style.fontSize = '0.9em';
	span.style.cursor = 'help';
	return span;
}

// ── Shared cache ────────────────────────────────────────────────────────────

function createSlotCache<Renderer, Cached>(
	cap = DEFAULT_CAP,
	cloneOnRead?: (value: Cached) => Cached
) {
	const newMemo = () => createBoundedMemo<string, Cached>({ cap, cloneOnRead });
	let renderer: Renderer | null = null;
	let memo = newMemo();
	const set = (next: Renderer | null): void => {
		renderer = next;
		memo = newMemo();
	};
	// A renderer is process-global like a registration, so the platform's test reset drops it too.
	enrollTestReset(() => set(null));
	return {
		set,
		renderer: () => renderer,
		// NUL-joined so no (theme, key) pair can run into another pair's key.
		read: (theme: string, key: string, compute: () => Cached): Cached =>
			memo(`${theme}\0${key}`, compute)
	};
}

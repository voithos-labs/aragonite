/**
 * The reuse pool that makes `component` inline widgets churn-safe. The editor
 * rebuilds a block's whole inline-DOM on every keystroke; without a pool each
 * rebuild would unmount and remount every widget's Svelte component (losing its
 * state and paying KaTeX-scale render cost per character). The pool keys live
 * instances by `${kind} ${source}` and adopts an unchanged widget's instance
 * across a rebuild instead of remounting it.
 *
 * Two pieces: the framework-free pool logic (`createWidgetPool`, unit-tested with
 * a fake adapter) and its Svelte binding (`createSvelteWidgetPool`), which owns the
 * atomic-island wrapper and `mount`/`unmount`. `mount`/`unmount` from 'svelte' are
 * used nowhere else in the repo — kept contained here on purpose.
 */

import { mount, unmount } from 'svelte';
import type { AnyInlineKind, InlineNode } from '../../core/nodes';
import { getInlineWidgetComponent } from '../../core/inline/inline-widgets';
import { tracePoolPass } from '../../debug/interaction-trace';
import { assertInvariant } from '../../invariants/assert';
import { checkPoolBracket } from '../../invariants/inline-transitions';

// ── Pure pool ─────────────────────────────────────────────────────────────────

export interface WidgetPoolAdapter<H> {
	/** Build one instance, or null when it cannot be built (a caught mount throw). */
	create(kind: AnyInlineKind, inline: InlineNode, source: string): H | null;
	destroy(handle: H): void;
	element(handle: H): HTMLElement;
}

export interface WidgetPool {
	/**
	 * Adopt the oldest un-adopted live instance for the key, marking it adopted
	 * this pass; else build a new one. Null when the adapter cannot build.
	 *
	 * Render-pass only: every acquire must sit inside a beginPass/sweep bracket.
	 * Key-only lookup cannot distinguish byte-identical duplicates, so any
	 * out-of-pass caller holding a specific element (the source-reveal fold-back)
	 * must restore that element itself, never re-look it up here.
	 */
	acquire(kind: AnyInlineKind, inline: InlineNode, source: string): HTMLElement | null;
	/** Open a rebuild pass: un-adopt every instance so this pass re-earns them. */
	beginPass(): void;
	/** Close a rebuild pass: destroy every instance not adopted in it. */
	sweep(): void;
	/** Destroy everything — the block is unmounting. */
	dispose(): void;
}

interface PoolEntry<H> {
	handle: H;
	adopted: boolean;
}

export function createWidgetPool<H>(adapter: WidgetPoolAdapter<H>): WidgetPool {
	// Multiset per `${kind} ${source}` key: two identical sources in one block are
	// two entries in one bucket, each adopted at most once per pass.
	const buckets = new Map<string, PoolEntry<H>[]>();
	// The acquire bracket (see WidgetPool.acquire) held as explicit state so a
	// violation fires at this seam instead of surfacing as a widget leak (G1.25).
	let passOpen = false;
	// Per-pass adopt/build tallies for the interaction trace, recorded at sweep.
	let passAdopt = 0;
	let passBuild = 0;

	function beginPass(): void {
		assertInvariant('pool-bracket', () => checkPoolBracket(passOpen, 'beginPass'));
		passOpen = true;
		passAdopt = 0;
		passBuild = 0;
		for (const bucket of buckets.values()) {
			for (const entry of bucket) entry.adopted = false;
		}
	}

	function acquire(kind: AnyInlineKind, inline: InlineNode, source: string): HTMLElement | null {
		assertInvariant('pool-bracket', () => checkPoolBracket(passOpen, 'acquire'));
		const key = `${kind} ${source}`;
		const bucket = buckets.get(key);
		const reused = bucket?.find((entry) => !entry.adopted);
		if (reused) {
			reused.adopted = true;
			passAdopt++;
			// The source (and so the rendered body) is identical by key; only the
			// widget's position in the block may have shifted, so re-stamp the offsets
			// the cursor/selection machinery reads.
			const el = adapter.element(reused.handle);
			el.dataset.sourceStart = String(inline.start);
			el.dataset.sourceEnd = String(inline.end);
			return el;
		}
		const handle = adapter.create(kind, inline, source);
		if (handle === null) return null;
		passBuild++;
		const entry: PoolEntry<H> = { handle, adopted: true };
		if (bucket) bucket.push(entry);
		else buckets.set(key, [entry]);
		return adapter.element(handle);
	}

	function sweep(): void {
		assertInvariant('pool-bracket', () => checkPoolBracket(passOpen, 'sweep'));
		passOpen = false;
		let destroyed = 0;
		for (const [key, bucket] of [...buckets]) {
			const survivors: PoolEntry<H>[] = [];
			for (const entry of bucket) {
				if (entry.adopted) {
					entry.adopted = false;
					survivors.push(entry);
				} else {
					adapter.destroy(entry.handle);
					destroyed++;
				}
			}
			if (survivors.length) buckets.set(key, survivors);
			else buckets.delete(key);
		}
		tracePoolPass(passAdopt, passBuild, destroyed);
	}

	function dispose(): void {
		passOpen = false;
		for (const bucket of buckets.values()) {
			for (const entry of bucket) adapter.destroy(entry.handle);
		}
		buckets.clear();
	}

	return { acquire, beginPass, sweep, dispose };
}

// ── Svelte adapter ──────────────────────────────────────────────────────────────

interface PortalHandle {
	wrapper: HTMLSpanElement;
	instance: Record<string, unknown>;
}

/**
 * The pool wired to Svelte mounting. `create` builds the atomic-island wrapper
 * carrying the attributes the cursor/selection machinery keys on, then mounts the
 * kind's component inside it with frozen `{ inline, source }` props. A synchronous
 * mount throw is caught, reported through `reportError` (the editor's `error`
 * channel), and surfaced as null so the caller falls back to the raw span.
 */
export function createSvelteWidgetPool(reportError?: (error: unknown) => void): WidgetPool {
	return createWidgetPool<PortalHandle>({
		create(kind, inline, source) {
			const component = getInlineWidgetComponent(kind);
			if (!component) return null;
			const wrapper = document.createElement('span');
			wrapper.dataset.inlineWidget = '';
			wrapper.dataset.sourceStart = String(inline.start);
			wrapper.dataset.sourceEnd = String(inline.end);
			wrapper.setAttribute('contenteditable', 'false');
			try {
				const instance = mount(component, { target: wrapper, props: { inline, source } });
				return { wrapper, instance };
			} catch (error) {
				reportError?.(error);
				return null;
			}
		},
		destroy(handle) {
			void unmount(handle.instance);
		},
		element(handle) {
			return handle.wrapper;
		}
	});
}

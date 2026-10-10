/**
 * The reuse pool that makes `component` inline widgets churn-safe. The editor rebuilds a block's
 * whole inline-DOM on every keystroke; without a pool each rebuild remounts every widget's Svelte
 * component, losing state and paying KaTeX-scale cost per character. Instances key by
 * `${kind} ${source}`, and `mount`/`unmount` from 'svelte' stay contained here.
 */

import { mount, unmount } from 'svelte';
import type { AnyInlineKind, InlineNode } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import { inlineReaderFor } from '../../core/inline';
import {
	getInlineWidgetComponent,
	getInlineWidgetEditing,
	widgetActivates
} from '../../core/inline/inline-widgets';
import type { ActivationClick } from '../../activation-click';
import type { Reading } from '../../schema/reading';
import { tracePoolPass } from '../../debug/interaction-trace';
import { assertInvariant } from '../../assert';
import { checkPoolBracket } from '../../invariants/inline-transitions';

// ── Pure pool ─────────────────────────────────────────────────────────────────

export interface WidgetPoolAdapter<H> {
	/** Build one instance, or null when it cannot be built (a caught mount throw). */
	create(kind: AnyInlineKind, inline: InlineNode, source: string): H | null;
	destroy(handle: H): void;
	element(handle: H): HTMLElement;
}

export interface WidgetPool {
	/** Adopts the oldest unadopted instance for the key, else builds one; call only inside a
	 *  beginPass/sweep bracket. Identical sources share a key, so a caller holding one restores it. */
	acquire(kind: AnyInlineKind, inline: InlineNode, source: string): HTMLElement | null;
	/** Open a rebuild pass: un-adopt every instance so this pass re-earns them. */
	beginPass(): void;
	/** Close a rebuild pass: destroy every instance not adopted in it. */
	sweep(): void;
	/** Destroy everything, because the block is unmounting. */
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
	// mistake fails here instead of showing up later as a leaked widget (G1.25).
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
			// Source and rendered body are identical by key; only the widget's position
			// may have shifted, so write the offsets the cursor and selection read again.
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

/** The live channels a mounted widget reads beside its frozen `{ inline, source }` snapshot. All
 *  required, so no widget falls back to a value the editor does not hold. */
export interface SvelteWidgetPoolDeps {
	/** A widget component's synchronous mount throw goes here (the editor's `error` channel). */
	reportError: (error: unknown) => void;
	/** The editor's theme name, for a widget that draws its own colors where CSS cannot reach. */
	getTheme: () => string;
	getDocument: () => DocumentView | undefined;
	getContentVersion: () => number;
	/** The editor's navigation call, for a widget whose gesture jumps elsewhere in the document. */
	navigateTo: (path: number[], offset?: number) => Promise<boolean>;
	/** How the editor reads its bytes: a widget kind whose plugin it left out mounts nothing, and a
	 *  mounted widget reads the mode and parses inline content through it. */
	reading: Reading;
	/** Whether a click follows what it lands on in this editor, for a widget that goes somewhere. */
	activationClick: ActivationClick;
}

/** A mount throw is reported and returns null, so the caller falls back to the raw span. The
 *  getters are live props beside the frozen snapshot, since a pooled instance outlives a mode switch. */
export function createSvelteWidgetPool(deps: SvelteWidgetPoolDeps): WidgetPool {
	const { reportError, getTheme, getDocument, getContentVersion, navigateTo, reading } = deps;
	const { activationClick } = deps;
	const { grammar } = reading;
	return createWidgetPool<PortalHandle>({
		create(kind, inline, source) {
			const component = getInlineWidgetComponent(kind, grammar);
			if (!component) return null;
			const wrapper = document.createElement('span');
			wrapper.dataset.inlineWidget = '';
			wrapper.dataset.sourceStart = String(inline.start);
			wrapper.dataset.sourceEnd = String(inline.end);
			wrapper.setAttribute('contenteditable', 'false');
			try {
				const instance = mount(component, {
					target: wrapper,
					props: {
						inline,
						source,
						getPresentationMode: reading.mode,
						getTheme,
						getDocument,
						getContentVersion,
						navigateTo,
						// A getter, so a pooled widget's reader changes with the document's definitions.
						get computeInlineContent() {
							return inlineReaderFor(reading);
						},
						// Read per click: a pooled widget outlives a mode switch and a policy augment.
						isActivationClick: (click) =>
							widgetActivates(getInlineWidgetEditing(kind, grammar), click, activationClick)
					}
				});
				return { wrapper, instance };
			} catch (error) {
				reportError(error);
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

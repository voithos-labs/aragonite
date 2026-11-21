/**
 * The reuse pool that keeps a plugin's inline widgets mounted across rebuilds. The editor rebuilds
 * a block's whole inline DOM on every keystroke; without a pool each rebuild remounts every
 * widget's view, losing its state and paying KaTeX-scale cost per character. Instances key by
 * `${kind} ${source}`.
 */

import type { AnyInlineKind, InlineNode } from '../../core/nodes';
import type { DocumentView } from '../../core/node-views';
import { inlineReaderFor } from '../../core/inline';
import {
	getInlineWidgetEditing,
	widgetActivates,
	widgetOf,
	type InlineWidgetComponentProps,
	type WidgetEditing,
	type WidgetEntry
} from '../../core/inline/inline-widgets';
import type { WidgetProps } from '../../schema/inline-type';
import type { Editor } from '../../schema/plugin-unit';
import { mintWidgetShell, widgetSourceRange } from '../../core/inline/widget-shell';
import type { ActivationClick, ClickInput } from '../../activation-click';
import type { Reading } from '../../schema/reading';
import { tracePoolPass } from '../../debug/interaction-trace';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkPoolBracket } from '../../invariants/inline-transitions';
import { mountPluginView, type MountedPluginView } from '../../plugin-view';

// ── Pure pool ─────────────────────────────────────────────────────────────────

export interface WidgetPoolAdapter<H> {
	/** Build one instance, or null when it cannot be built (a caught mount throw), which the pool
	 *  remembers so the key isn't built again while it stays in the block. */
	create(kind: AnyInlineKind, inline: InlineNode, source: string): H | null;
	/** Tell a reused instance typing moved it; false when it can't follow (its view threw). */
	move(handle: H, inline: InlineNode): boolean;
	/** Whether a reused instance drew for a mode or theme the editor has left, so it's moved too. */
	stale?(handle: H): boolean;
	destroy(handle: H): void;
	element(handle: H): HTMLElement;
}

export interface WidgetPool {
	/** Adopts the oldest unadopted instance for the key, else builds one; call only inside a
	 *  beginPass/sweep bracket. Identical sources share a key, so a caller holding one restores it. */
	acquire(kind: AnyInlineKind, inline: InlineNode, source: string): HTMLElement | null;
	/** Keeps the oldest unadopted instance for the key through the pass without drawing it, so a
	 *  widget whose source is shown comes back as the same instance when it closes unedited. */
	retain(kind: AnyInlineKind, source: string): void;
	/** Open a rebuild pass: un-adopt every instance so this pass re-earns them. */
	beginPass(): void;
	/** Close a rebuild pass: destroy every instance not adopted in it. */
	sweep(): void;
	/** Tells every instance the block holds of a mode or theme it didn't draw for. */
	refresh(): void;
	/** Destroy everything, because the block is unmounting. */
	dispose(): void;
}

interface PoolEntry<H> {
	/** Null once its view threw: the source shows in its place, and nothing mounts again while the
	 *  key stays in the block. */
	handle: H | null;
	adopted: boolean;
	/** The node it last drew, for a refresh between rebuilds. */
	inline: InlineNode;
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
		// A live instance first, so a failed twin never takes the adoption from a healthy one.
		const reused =
			bucket?.find((entry) => !entry.adopted && entry.handle !== null) ??
			bucket?.find((entry) => !entry.adopted);
		if (reused) {
			reused.adopted = true;
			reused.inline = inline;
			if (reused.handle === null) return null;
			passAdopt++;
			// Source and rendered body are identical by key; only the widget's position may have
			// shifted, and the offsets the cursor and selection read follow it.
			const el = adapter.element(reused.handle);
			const stamped = widgetSourceRange(el);
			const moved = stamped?.start !== inline.start || stamped?.end !== inline.end;
			if (moved) {
				el.dataset.sourceStart = String(inline.start);
				el.dataset.sourceEnd = String(inline.end);
			}
			if ((moved || adapter.stale?.(reused.handle)) && !adapter.move(reused.handle, inline)) {
				adapter.destroy(reused.handle);
				reused.handle = null;
				return null;
			}
			return el;
		}
		const handle = adapter.create(kind, inline, source);
		const entry: PoolEntry<H> = { handle, adopted: true, inline };
		if (bucket) bucket.push(entry);
		else buckets.set(key, [entry]);
		if (handle === null) return null;
		passBuild++;
		return adapter.element(handle);
	}

	function retain(kind: AnyInlineKind, source: string): void {
		assertInvariant('pool-bracket', () => checkPoolBracket(passOpen, 'retain'));
		const kept = buckets.get(`${kind} ${source}`)?.find((entry) => !entry.adopted);
		if (kept) kept.adopted = true;
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
				} else if (entry.handle !== null) {
					adapter.destroy(entry.handle);
					destroyed++;
				}
			}
			if (survivors.length) buckets.set(key, survivors);
			else buckets.delete(key);
		}
		tracePoolPass(passAdopt, passBuild, destroyed);
	}

	function refresh(): void {
		for (const bucket of buckets.values()) {
			for (const entry of bucket) {
				if (entry.handle === null || !adapter.stale?.(entry.handle)) continue;
				if (adapter.move(entry.handle, entry.inline)) continue;
				adapter.destroy(entry.handle);
				entry.handle = null;
			}
		}
	}

	function dispose(): void {
		passOpen = false;
		for (const bucket of buckets.values()) {
			for (const entry of bucket) if (entry.handle !== null) adapter.destroy(entry.handle);
		}
		buckets.clear();
	}

	return { acquire, retain, beginPass, sweep, refresh, dispose };
}

// ── View adapter ────────────────────────────────────────────────────────────────

interface ViewHandle {
	shell: HTMLSpanElement;
	view: MountedPluginView<never>;
	/** What the view is handed at `inline`, and whether it already holds it. */
	update(inline: InlineNode): boolean;
	stale(): boolean;
}

/** The live channels a mounted widget reads beside its `{ inline, source }`. All required, so no
 *  widget falls back to a value the editor does not hold. */
export interface ViewWidgetPoolDeps {
	/** A widget view's throw goes here (the editor's `error` channel). */
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
	/** What an `inline()` widget's props read: its plugin's editor, and where a byte of the block
	 *  sits in the document. */
	own: OwnWidgetContext;
}

export interface OwnWidgetContext {
	editorFor(plugin: string): Editor;
	byteAt(offset: number): number;
}

/** A view that throws is reported and its widget falls back to the raw span. */
export function createViewWidgetPool(deps: ViewWidgetPoolDeps): WidgetPool {
	const { reportError, getTheme, getDocument, getContentVersion, navigateTo, reading } = deps;
	const { activationClick } = deps;
	const { grammar } = reading;
	return createWidgetPool<ViewHandle>({
		create(kind, inline, source) {
			const entry = widgetOf(kind, grammar);
			if (entry?.own) return ownHandle(entry.own, entry.editing, kind, inline, source);
			const view = entry?.view;
			if (!view) return null;
			// Read per click: a pooled widget outlives a mode switch and a policy augment.
			const isActivationClick = (click: ClickInput) =>
				widgetActivates(getInlineWidgetEditing(kind, grammar), click, activationClick);
			// Every prop but `inline` keeps its identity across a move, so a view re-renders only
			// what reads the offsets.
			const props = (at: InlineNode): InlineWidgetComponentProps => ({
				inline: at,
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
				isActivationClick
			});
			const shell = mintWidgetShell(inline);
			// What the view draws there is the plugin's, so the editor's own reset leaves it alone.
			shell.dataset.hostContent = '';
			const mounted = mountPluginView(view, shell, props(inline), {
				report: reportError,
				subject: `inline widget ${kind}`
			});
			if (!mounted) return null;
			return {
				shell,
				view: mounted as MountedPluginView<never>,
				update: (at) => mounted.update(props(at)),
				stale: () => false
			};
		},
		move: (handle, inline) => handle.update(inline),
		stale: (handle) => handle.stale(),
		destroy(handle) {
			ownProps.delete(handle.shell);
			handle.view.destroy();
		},
		element(handle) {
			return handle.shell;
		}
	});

	function ownHandle(
		own: NonNullable<WidgetEntry['own']>,
		editing: WidgetEditing | undefined,
		kind: AnyInlineKind,
		inline: InlineNode,
		source: string
	): ViewHandle | null {
		const editor = deps.own.editorFor(own.plugin);
		const propsAt = (at: InlineNode): WidgetProps<unknown> => ({
			data: at.data,
			source,
			get from() {
				return deps.own.byteAt(at.start);
			},
			get to() {
				return deps.own.byteAt(at.end);
			},
			mode: reading.mode(),
			theme: getTheme(),
			editor
		});
		let props = propsAt(inline);
		const shell = mintWidgetShell(inline);
		shell.dataset.hostContent = '';
		const mounted = mountPluginView(own.draw, shell, props, {
			report: reportError,
			subject: `inline widget ${kind}`
		});
		if (!mounted) return null;
		ownProps.set(shell, { props: () => props, key: own.key });
		// The editor decides the click, by the rule every followed click asks.
		if (own.follow) {
			const follow = own.follow;
			shell.addEventListener('click', (e) => {
				if (!widgetActivates(editing, e, activationClick)) return;
				e.preventDefault();
				follow(props.data, editor);
			});
		}
		return {
			shell,
			view: mounted as MountedPluginView<never>,
			update(at) {
				props = propsAt(at);
				return mounted.update(props);
			},
			stale: () => props.mode !== reading.mode() || props.theme !== getTheme()
		};
	}
}

/** Runs an `inline()` widget's `key` with the props its drawing holds; null for any other widget. */
export function keyOwnWidget(shell: HTMLElement, event: KeyboardEvent): boolean | null {
	const held = ownProps.get(shell);
	if (!held) return null;
	return held.key?.(event, held.props()) ?? false;
}

// The props each mounted `inline()` widget drew with, which its `key` gets too.
const ownProps = new WeakMap<
	HTMLElement,
	{
		props: () => WidgetProps<unknown>;
		key: NonNullable<WidgetEntry['own']>['key'];
	}
>();

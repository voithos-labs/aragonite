/**
 * The event subscription object reached through `getEvents()`. Events fire synchronously and a
 * handler must not mutate the document; an `edit` event fires after its change is written and
 * announced, so its handler sees the updated document.
 */

import type { AnyBlockKind } from './core/nodes';
import { devChecksOn, devWarn } from '@voithos-labs/aragonite/dev-checks';
import type { Mode, PresentationMode } from './presentation-mode';
import type { EditorSelection } from './selection/primitives';
import type { OpDescriptor, OperationDetailMap, OperationKind } from './schema/operations';
import type { Doc } from './schema/doc-view';
import type { Selection } from './schema/selection-read';

// ── What `Editor.on` hears ───────────────────────────────────────────────

/** Bytes `from` to `to` of the document before a write gave way to `insert`. */
export interface Change {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

/** One write as it lands: its operation and detail, the document after it, and what it replaced,
 *  worked out only when `changes` is read. */
export type EditInfo = {
	[K in OperationKind]: {
		readonly op: K;
		readonly detail: OperationDetailMap[K];
		readonly doc: Doc;
		readonly changes: readonly Change[];
		readonly timestamp: number;
	};
}[OperationKind];

/** The event map a plugin listens on, each event with what its listener gets. */
export interface Events {
	edit: EditInfo;
	selection: { readonly selection: Selection | null };
	mode: Mode;
	theme: string;
	menu: boolean;
	/** A whole document replaced the last: a `source` change or `load`. No `edit` fires for it. */
	load: { readonly doc: Doc; readonly generation: number };
	search: void;
	error: EditorError;
}

// ── Edit event union ─────────────────────────────────────────────────────

/** Derived per operation from `OperationDetailMap`; see `schema/operations.ts`. */
export type EditEvent = {
	[K in OperationKind]: undefined extends OperationDetailMap[K]
		? { op: K; path: number[]; detail?: OperationDetailMap[K]; timestamp: number }
		: { op: K; path: number[]; detail: OperationDetailMap[K]; timestamp: number };
}[OperationKind];

/** The cast is sound by construction: both types come from `OperationDetailMap`, which
 *  TypeScript cannot narrow as a correlated union. */
export function toEditEvent(op: OpDescriptor, path: number[], timestamp: number): EditEvent {
	return { op: op.kind, path, detail: op.detail, timestamp } as EditEvent;
}

export type SelectionChangeEvent = EditorSelection | null;

export interface EditorError {
	/**
	 * `clipboard` is a failure while pasting: the channel a host needs in order to release
	 * an asset `onPasteImage` already imported for it.
	 */
	origin: 'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard' | 'link';
	error: unknown;
	/** Origin-specific: `path` for render, `op`+`path` for commit, `kind`+`command` (+`plugin`) for a
	 *  command, `source` for decoration, `url` for link, the aimed-at start path for clipboard. */
	context?: {
		path?: number[];
		op?: OperationKind;
		kind?: AnyBlockKind;
		command?: string;
		plugin?: string;
		source?: string;
		url?: string;
	};
}

// ── Map of event name → handler payload ─────────────────────────────────

export interface EditorEventMap {
	/** Fires at each write, as it lands: a structural edit, one keystroke, an undo or a redo. */
	edit: EditEvent;
	selectionChange: SelectionChangeEvent;
	/** A failure the editor contained. A listener added after the editor mounts (in a Svelte
	 *  parent's `onMount`, say) misses the plugin errors raised while it mounted; `onError` hears those. */
	error: EditorError;
	/** The mode in effect after a `presentationMode` prop change (never fired at mount). */
	presentationModeChange: PresentationMode;
	/** The theme name after a `theme` prop change (never fired at mount), for a plugin
	 *  that paints its own colors and so cannot pick the change up from CSS. */
	themeChange: string;
	/** `true` when an editor-owned menu or popover opens while none was, `false` when the last one
	 *  closes, so a host's own controls over the selection can step aside rather than stack. */
	menuChange: boolean;
	/** A `source` prop write replaced the whole document. Fires once the new tree, its selection
	 *  and its link references are in place; an `edit` never fires for it. */
	sourceSwap: SourceSwapEvent;
	/** What the find bar shows changed: open or closed, its query, options, current match, error, or
	 *  either count. Once per change, after a regex scan or a replace lands; read `getSearch()`. */
	searchChange: void;
}

/** `generation` counts whole-document replacements since mount, starting at 1. */
export interface SourceSwapEvent {
	generation: number;
}

export interface EditorEvents {
	on<K extends keyof EditorEventMap>(
		event: K,
		handler: (payload: EditorEventMap[K]) => void
	): () => void;
	/** Internal emit; not exported from `index.ts`. */
	emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): void;
}

/** The editor's own side of the channel: `end` at unmount, after which nothing is emitted. */
export interface EditorEventChannel extends EditorEvents {
	/** Also says whether a listener heard it. */
	emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): boolean;
	end(): void;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createEditorEvents(): EditorEventChannel {
	// One value type for every entry avoids the unsound indexed write on a mapped type with
	// a generic key; per-event safety still holds at the public `on` and `emit`.
	type AnyHandler = (payload: unknown) => void;
	const handlers: Partial<Record<keyof EditorEventMap, Set<AnyHandler>>> = {};
	let ended = false;

	function on<K extends keyof EditorEventMap>(
		event: K,
		handler: (payload: EditorEventMap[K]) => void
	): () => void {
		const set = (handlers[event] ??= new Set<AnyHandler>());
		const erased = handler as AnyHandler;
		set.add(erased);
		return () => {
			set.delete(erased);
		};
	}

	function emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): boolean {
		const set = handlers[event];
		if (!set?.size || ended) return false;
		// Copy so self-disposing handlers don't mutate the set mid-iteration.
		// try/catch per handler so one throwing subscriber doesn't starve others.
		for (const handler of [...set]) {
			try {
				(handler as (p: EditorEventMap[K]) => void)(payload);
			} catch (err) {
				// An error-channel subscriber that throws is reported rather than re-emitted,
				// which would loop. Anything the channel cannot report fails a gate instead.
				if (event !== 'error' && handlers.error?.size) {
					emit('error', { origin: 'subscriber', error: err });
				} else if (devChecksOn) {
					devWarn('events', `${event} subscriber threw`, err);
				} else {
					// `devWarn` is silent in production, and swallowing here would hide an exception
					// the consumer's own handler threw, which an unguarded call would have shown.
					console.error(`[aragonite] ${event} subscriber threw`, err);
				}
			}
		}
		return true;
	}

	return {
		on,
		emit,
		end: () => {
			ended = true;
		}
	};
}

// ── Contained-failure routing ──────────────────────────────────────────────
// One builder per origin that has more than one emission site, kept here so the code that
// owns the channel owns the payload shape too.

/** Report a thrown command to the `error` channel with the plugin that registered it. */
export function emitCommandError(
	events: EditorEvents | undefined,
	report: { kind?: AnyBlockKind; command: string; plugin?: string; error: unknown }
): void {
	events?.emit('error', {
		origin: 'command',
		error: report.error,
		context: {
			kind: report.kind,
			command: report.command,
			plugin: report.plugin
		}
	});
}

/** Report a failed or refused write to the `error` channel with its op and document path. */
export function emitCommitError(
	events: Pick<EditorEvents, 'emit'>,
	report: { error: unknown; op?: OperationKind; path?: number[] }
): void {
	events.emit('error', {
		origin: 'commit',
		error: report.error,
		context: { op: report.op, path: report.path }
	});
}

/** Report a link the scheme allowlist refused to the `error` channel. Default activation only: a
 *  consumer supplying `onLinkActivate` owns its own policy. */
export function emitBlockedLinkError(events: EditorEvents | undefined, url: string): void {
	events?.emit('error', {
		origin: 'link',
		error: new Error(`aragonite: blocked link with disallowed scheme: ${url}`),
		context: { url }
	});
}

/** Report a clipboard failure to the `error` channel. `path` is left out when the paste aimed at
 *  no range, since `[]` would name the document root, which holds no caret. */
export function emitClipboardError(
	events: EditorEvents,
	report: { error: unknown; path?: number[] }
): void {
	events.emit('error', {
		origin: 'clipboard',
		error: report.error,
		...(report.path ? { context: { path: report.path } } : {})
	});
}

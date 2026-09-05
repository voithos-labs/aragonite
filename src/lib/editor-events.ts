/**
 * Observer-pattern event surface reached via `getEvents()`. Events fire synchronously
 * and handlers must NOT mutate the document; an `edit` event fires after its mutation
 * is published, so its handler sees the updated document.
 */

import type { AnyBlockKind } from './core/nodes';
import { devWarn } from './dev-warn';
import { editorEnv } from './env';
import type { PresentationMode } from './presentation-mode';
import type { EditorSelection } from './selection/primitives';
import type { OpDescriptor, OperationDetailMap, OperationKind } from './schema/operations';
import { pluginKindOwner } from './schema/plugin-install';

// ── Edit event union ─────────────────────────────────────────────────────

/** Derived per-arm from OperationDetailMap — see schema/operations.ts. */
export type EditEvent = {
	[K in OperationKind]: undefined extends OperationDetailMap[K]
		? { op: K; path: number[]; detail?: OperationDetailMap[K]; timestamp: number }
		: { op: K; path: number[]; detail: OperationDetailMap[K]; timestamp: number };
}[OperationKind];

/** The cast is sound by construction: both types derive from OperationDetailMap, which
 *  TS cannot narrow as a correlated union. */
export function toEditEvent(op: OpDescriptor, path: number[], timestamp: number): EditEvent {
	return { op: op.kind, path, detail: op.detail, timestamp } as EditEvent;
}

export type SelectionChangeEvent = EditorSelection | null;

export interface EditorError {
	/**
	 * `clipboard` is a failure on the paste route — the channel a host needs to release
	 * an asset `onPasteImage` already imported for it.
	 */
	origin: 'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard' | 'link';
	error: unknown;
	/** Origin-specific: `path` for render, `op`+`path` for commit, `kind`+`command`
	 *  (+`plugin`) for a command throw, `source` for decoration, `url` for link, and the
	 *  paste's start path for clipboard when it was aimed at a range. */
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
	edit: EditEvent;
	selectionChange: SelectionChangeEvent;
	error: EditorError;
	/** The EFFECTIVE mode after a `presentationMode` prop change (never fired at mount). */
	presentationModeChange: PresentationMode;
	/** The theme name after a `theme` prop change (never fired at mount), for a plugin
	 *  that paints its own colors and so cannot pick the change up from CSS. */
	themeChange: string;
}

export interface EditorEvents {
	on<K extends keyof EditorEventMap>(
		event: K,
		handler: (payload: EditorEventMap[K]) => void
	): () => void;
	/** Internal emit — not exported from index.ts. */
	emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): void;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createEditorEvents(): EditorEvents {
	// Uniform value type sidesteps the generic-K indexed-write unsoundness on mapped
	// types; per-event safety is preserved at the public on/emit boundary.
	type AnyHandler = (payload: unknown) => void;
	const handlers: Partial<Record<keyof EditorEventMap, Set<AnyHandler>>> = {};

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

	function emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): void {
		const set = handlers[event];
		if (!set) return;
		// Copy so self-disposing handlers don't mutate the set mid-iteration.
		// try/catch per handler so one throwing subscriber doesn't starve others.
		for (const handler of [...set]) {
			try {
				(handler as (p: EditorEventMap[K]) => void)(payload);
			} catch (err) {
				// Recursion guard: an error-channel subscriber's own throw reports rather than
				// re-emitting, which would loop. Everything the channel cannot carry reds a gate.
				if (event !== 'error' && handlers.error?.size) {
					emit('error', { origin: 'subscriber', error: err });
				} else if (editorEnv.isDev) {
					devWarn('events', `${event} subscriber threw`, err);
				} else {
					// devWarn is silent in production, and the swallow is what hides an exception the
					// consumer's own handler threw, which an unguarded call would have surfaced.
					console.error(`[aragonite] ${event} subscriber threw`, err);
				}
			}
		}
	}

	return { on, emit };
}

// ── Contained-failure routing ──────────────────────────────────────────────
// One envelope minter per origin with more than one emission site, living here so the
// shell that owns the channel owns the payload shape too.

/**
 * Route a contained command throw to the `error` channel, attributing the command and
 * its owning plugin; no-ops when no events surface is present. A direct `plugin` wins
 * over the kind lookup, so a global command's own owner is never clobbered by one.
 */
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
			plugin:
				report.plugin ?? (report.kind ? (pluginKindOwner(report.kind) ?? undefined) : undefined)
		}
	});
}

/**
 * Route a blocked link activation to the `error` channel: the scheme allowlist refused the URL,
 * which a host may want to log or surface. Fires for the DEFAULT activation only — a consumer
 * supplying `onLinkActivate` owns its own policy.
 */
export function emitBlockedLinkError(events: EditorEvents | undefined, url: string): void {
	events?.emit('error', {
		origin: 'link',
		error: new Error(`aragonite: blocked link with disallowed scheme: ${url}`),
		context: { url }
	});
}

/**
 * Route a contained clipboard-route failure to the `error` channel. `path` addresses the
 * range the paste was aimed at and is OMITTED where there is none to name — `[]` would
 * report the document root, which holds no caret.
 */
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

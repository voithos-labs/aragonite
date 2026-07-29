/**
 * Observer-pattern event surface reached via the editor component's
 * `getEvents()` accessor. Events fire synchronously; handlers must NOT mutate
 * the document. An `edit` event fires after its mutation is published, so its
 * handler sees the updated document.
 */

import type { AnyBlockKind } from './core/nodes';
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

/**
 * OpDescriptor → EditEvent. The cast is sound by construction: both types
 * derive from OperationDetailMap, TS just can't narrow the correlated union.
 */
export function toEditEvent(op: OpDescriptor, path: number[], timestamp: number): EditEvent {
	return { op: op.kind, path, detail: op.detail, timestamp } as EditEvent;
}

export type SelectionChangeEvent = EditorSelection | null;

export interface EditorError {
	/**
	 * `clipboard` is a failure on the paste route — a paste that consumed the
	 * gesture and inserted nothing, or a host import hook that threw. The channel
	 * a host needs to release an asset `onPasteImage` already imported for it.
	 */
	origin: 'subscriber' | 'render' | 'commit' | 'command' | 'decoration' | 'clipboard';
	error: unknown;
	/**
	 * Origin-specific context: block path for render, op kind + event path for
	 * commit, the block kind + command id (+ owning plugin, when recorded) for a
	 * contained plugin block-command throw, the source name for a decoration
	 * provide that threw, and — when the paste was aimed at a range — its start
	 * path for a clipboard failure.
	 */
	context?: {
		path?: number[];
		op?: OperationKind;
		kind?: AnyBlockKind;
		command?: string;
		plugin?: string;
		source?: string;
	};
}

// ── Map of event name → handler payload ─────────────────────────────────

export interface EditorEventMap {
	edit: EditEvent;
	selectionChange: SelectionChangeEvent;
	error: EditorError;
	/** The EFFECTIVE mode after a `presentationMode` prop change (never fired at mount). */
	presentationModeChange: PresentationMode;
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
	// Uniform value type sidesteps the generic-K indexed-write unsoundness on
	// mapped types (TS would otherwise require the write to satisfy the
	// intersection of every slot type). Per-event type safety is preserved at
	// the public on/emit boundary via a single cast where K is concrete.
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
				// Recursion guard + never-silently-drop: an error-channel subscriber
				// that throws logs (no re-emit, would loop); a non-error throw routes
				// to the error channel when someone listens, else falls back to log.
				if (event === 'error') {
					console.error('[EditorEvents] error-channel subscriber threw:', err);
				} else if (handlers.error?.size) {
					emit('error', { origin: 'subscriber', error: err });
				} else {
					console.error('[EditorEvents] subscriber threw (no error handler):', err);
				}
			}
		}
	}

	return { on, emit };
}

// ── Contained-failure routing ──────────────────────────────────────────────
//
// One envelope minter per origin that has more than one emission site. They live
// here, not in the layers that decline, so the shell that owns the channel owns
// the payload shape too.

/**
 * Route a contained command throw to the `error` channel as an `origin: 'command'`
 * event, attributing the command id and its owning plugin. The single place the
 * dispatch seam's `CommandErrorSink` reaches the editor's event surface; no-ops
 * when no events surface is present (a mount without the context). Kept here, not
 * in the schema dispatch layer, so the attribution + emit live with the shell that
 * owns the channel.
 *
 * Attribution: a global command reports its own `plugin` and carries no kind, so
 * that owner wins; a block command reports its `kind`, and the owner is resolved
 * by kind lookup. The direct `plugin` therefore never gets clobbered by a lookup.
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
 * Route a contained failure on the clipboard route to the `error` channel as an
 * `origin: 'clipboard'` event. Two shapes reach it, and a host reads both for the
 * same purpose — deciding whether an asset it imported for `onPasteImage` is now
 * orphaned: a paste that consumed the gesture and inserted nothing, and a host
 * import hook that threw while the rest of the paste still landed.
 *
 * `path` addresses the range the paste was aimed at and is OMITTED where there is
 * none to name — an absent field is honest, while `[]` would report the document
 * root, which holds no caret.
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

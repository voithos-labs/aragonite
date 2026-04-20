/**
 * Observer-pattern event surface exposed as `editor.events`. Subscribers
 * use `on(name, cb)` and receive a disposer. Events fire synchronously;
 * handler contract: do NOT mutate the document from inside a handler.
 *
 * Emission sites (by event kind):
 *   - `edit` with structural op: from inside `__commit`, after publish.
 *   - `edit` with op='input': from the keystroke-debounce flush.
 *   - `selectionChange`: from the selection-state change path.
 */

import type { EditorSelection } from '../selection/primitives';

// ── Edit event union ─────────────────────────────────────────────────────

export type EditEvent =
	| { op: 'split'; path: number[]; detail: { at: number }; timestamp: number }
	| {
			op: 'merge';
			path: number[];
			detail: { direction: 'prev' | 'next' };
			timestamp: number;
	  }
	| { op: 'delete'; path: number[]; timestamp: number }
	| { op: 'paste'; path: number[]; detail: { count: number }; timestamp: number }
	| { op: 'replaceBlock'; path: number[]; detail: { count: number }; timestamp: number }
	| { op: 'updateContent'; path: number[]; detail: { length: number }; timestamp: number }
	| { op: 'input'; path: number[]; detail: { byteLength: number }; timestamp: number }
	| { op: 'undo'; path: number[]; timestamp: number }
	| { op: 'redo'; path: number[]; timestamp: number };

export type SelectionChangeEvent = EditorSelection | null;

// ── Map of event name → handler payload ─────────────────────────────────

export interface EditorEventMap {
	edit: EditEvent;
	selectionChange: SelectionChangeEvent;
}

export interface EditorEvents {
	on<K extends keyof EditorEventMap>(
		event: K,
		handler: (payload: EditorEventMap[K]) => void
	): () => void;
	/** Internal emit — not exported from index.ts. Used by __commit / debounce / selection. */
	emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): void;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createEditorEvents(): EditorEvents {
	const handlers: {
		[K in keyof EditorEventMap]?: Set<(payload: EditorEventMap[K]) => void>;
	} = {};

	function on<K extends keyof EditorEventMap>(
		event: K,
		handler: (payload: EditorEventMap[K]) => void
	): () => void {
		const set = (handlers[event] ??= new Set()) as Set<(p: EditorEventMap[K]) => void>;
		set.add(handler);
		return () => {
			set.delete(handler);
		};
	}

	function emit<K extends keyof EditorEventMap>(event: K, payload: EditorEventMap[K]): void {
		const set = handlers[event] as Set<(p: EditorEventMap[K]) => void> | undefined;
		if (!set) return;
		// Copy before iterating so handlers that dispose themselves don't mutate
		// the set mid-iteration. Each handler runs in its own try/catch so a
		// throwing subscriber doesn't starve downstream subscribers — an
		// observer-pattern invariant that edit-event consumers (persistent
		// history, dirty tracking, op-log) rely on for independence.
		for (const handler of [...set]) {
			try {
				handler(payload);
			} catch (err) {
				console.error('[EditorEvents] subscriber threw while handling event:', err);
			}
		}
	}

	return { on, emit };
}

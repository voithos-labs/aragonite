/**
 * Observer-pattern event surface exposed as `editor.events`. Events fire
 * synchronously; handlers must NOT mutate the document.
 *
 * Emission sites:
 *   - `edit` structural op: inside `__commit`, after publish.
 *   - `edit` op='input': from the keystroke-debounce flush.
 *   - `selectionChange`: from the selection-state change path.
 */

import type { EditorSelection } from './selection/primitives';

// ── Edit event union ─────────────────────────────────────────────────────

export type EditEvent =
	| { op: 'split'; path: number[]; detail: { at: number }; timestamp: number }
	| {
			op: 'merge';
			path: number[];
			detail: { direction: 'prev' | 'next' };
			timestamp: number;
	  }
	| { op: 'delete'; path: number[]; detail?: {}; timestamp: number }
	| { op: 'paste'; path: number[]; detail: { count: number }; timestamp: number }
	| { op: 'replaceBlock'; path: number[]; detail: { count: number }; timestamp: number }
	| { op: 'updateContent'; path: number[]; detail: { length: number }; timestamp: number }
	| { op: 'input'; path: number[]; detail: { byteLength: number }; timestamp: number }
	| { op: 'appendBlock'; path: number[]; detail?: {}; timestamp: number }
	| { op: 'metadataUpdate'; path: number[]; detail: { fields: string[] }; timestamp: number }
	| { op: 'undo'; path: number[]; detail?: {}; timestamp: number }
	| { op: 'redo'; path: number[]; detail?: {}; timestamp: number }
	| {
			op: 'tableInsertRow';
			path: number[];
			detail: { rowIdx: number; side: 'above' | 'below' };
			timestamp: number;
	  }
	| { op: 'tableDeleteRow'; path: number[]; detail: { rowIdx: number }; timestamp: number }
	| {
			op: 'tableInsertColumn';
			path: number[];
			detail: { colIdx: number; side: 'left' | 'right' };
			timestamp: number;
	  }
	| { op: 'tableDeleteColumn'; path: number[]; detail: { colIdx: number }; timestamp: number }
	| { op: 'tableCycleAlignment'; path: number[]; detail: { colIdx: number }; timestamp: number };

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
				console.error('[EditorEvents] subscriber threw while handling event:', err);
			}
		}
	}

	return { on, emit };
}

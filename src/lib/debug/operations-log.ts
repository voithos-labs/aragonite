// ── Types ────────────────────────────────────────────────────────────────────

export type OperationKind =
	| 'split'
	| 'merge'
	| 'delete'
	| 'input'
	| 'updateContent'
	| 'replaceBlock'
	| 'paste'
	| 'appendBlock'
	| 'undo'
	| 'redo';

export interface OperationEntry {
	op: OperationKind;
	path: number[];
	detail: Record<string, unknown>;
	t: number;
}

export interface OpDescriptor {
	kind: OperationKind;
	detail?: Record<string, unknown>;
}

export interface OperationsLog {
	record(entry: Omit<OperationEntry, 't'>): void;
	snapshot(): OperationEntry[];
	subscribe(listener: (entry: OperationEntry) => void): () => void;
}

// ── Factory ──────────────────────────────────────────────────────────────────

/** Bounded FIFO log. Oldest entries are evicted once `capacity` is exceeded. */
export function createOperationsLog(capacity = 100): OperationsLog {
	const buf: OperationEntry[] = [];
	const listeners = new Set<(entry: OperationEntry) => void>();

	return {
		record(entry) {
			const stamped: OperationEntry = { ...entry, t: Date.now() };
			buf.push(stamped);
			if (buf.length > capacity) buf.splice(0, buf.length - capacity);
			for (const l of listeners) l(stamped);
		},

		snapshot() {
			return buf.slice();
		},

		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

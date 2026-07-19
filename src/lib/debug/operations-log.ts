import type { OperationKind } from '../schema/operations';

export interface OperationEntry {
	op: OperationKind;
	path: number[];
	detail: Record<string, unknown>;
	t: number;
}

export interface OperationsLog {
	record(entry: Omit<OperationEntry, 't'>): void;
	snapshot(): OperationEntry[];
	subscribe(listener: (entry: OperationEntry) => void): () => void;
}

/** Bounded FIFO; oldest entries evicted past `capacity`. */
export function createOperationsLog(capacity = 100): OperationsLog {
	const buf: OperationEntry[] = [];
	const listeners = new Set<(entry: OperationEntry) => void>();

	return {
		record(entry) {
			const stamped: OperationEntry = { ...entry, t: Date.now() };
			buf.push(stamped);
			if (buf.length > capacity) buf.splice(0, buf.length - capacity);
			// Snapshot before iterating so a self-disposing subscriber doesn't abort the loop.
			for (const l of [...listeners]) {
				try {
					l(stamped);
				} catch (err) {
					console.error('[OperationsLog] subscriber threw while handling entry:', err);
				}
			}
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

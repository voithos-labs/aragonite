/**
 * Keystroke batching: one undo entry per burst of typing, ended by a pause, a change of
 * batch key, or a structural commit. The batch groups undo steps only; each keystroke's `edit`
 * fires at its own write (`leaf-write.ts`). Snapshot capture stays with the controller, injected.
 */

export interface TextBatchDeps {
	/** Capture the pre-edit snapshot for the first keystroke of a batch. */
	pushSnapshot(leafPath: number[], offset: number): void;
	/** Told when a batch ends on an interrupt or a pause. */
	onEnd?(): void;
}

export interface TextBatch {
	/**
	 * The first keystroke of a batch pushes a snapshot. `batchKey` identifies the leaf
	 * being typed in, so sibling leaves never share a batch across a focus move.
	 */
	keystroke(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Start the pause timer once the keystroke's own edit has finished, so the editor's own
	 * work never counts as the user's pause. Does nothing without a live batch.
	 */
	armPause(): void;
	/** End the batch now: cancel the pause timer, and make the next keystroke push a fresh snapshot. */
	interrupt(): void;
}

/** 250 ms, matching Obsidian: longer reverts entire half-words at typical typing speeds. */
export const UNDO_DEBOUNCE_MS = 250;

export function createTextBatch(deps: TextBatchDeps): TextBatch {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastBatchKey: string | number = -1;
	let needsCheckpoint = true;

	function clearTimer(): void {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	return {
		keystroke(leafPath, offset, batchKey) {
			const key = batchKey ?? leafPath.join('.');
			if (lastBatchKey !== key || needsCheckpoint) {
				deps.pushSnapshot(leafPath, offset);
				lastBatchKey = key;
				needsCheckpoint = false;
			}
		},
		armPause() {
			if (needsCheckpoint) return;
			clearTimer();
			// A real-time pause, not async sequencing (G4.4 allowlist): tick() is a microtask
			// and cannot express "stopped typing for 250 ms".
			timer = setTimeout(() => {
				needsCheckpoint = true;
				timer = null;
				deps.onEnd?.();
			}, UNDO_DEBOUNCE_MS);
		},
		interrupt() {
			clearTimer();
			needsCheckpoint = true;
			deps.onEnd?.();
		}
	};
}

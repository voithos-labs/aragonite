/**
 * Keystroke-batch lifecycle: one undo entry per burst of typing, broken by a
 * wall-clock pause, a batch-key change, or a structural commit. Snapshot capture
 * itself stays with the controller, injected.
 */

export interface TextBatchDeps {
	/** Capture the pre-edit snapshot for the first keystroke of a batch. */
	pushSnapshot(leafPath: number[], offset: number): void;
	/** Emit the batched `input` edit event when a batch flushes. */
	emitInput(leafPath: number[], byteLength: number): void;
}

export interface TextBatch {
	/**
	 * The first keystroke of a batch pushes a snapshot. `batchKey` identifies the leaf
	 * being typed in, so sibling leaves never share a batch across a focus move.
	 */
	keystroke(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Structural-commit interrupt: cancel the pause timer, flush the pending input
	 * event, and require a fresh snapshot from the next keystroke.
	 */
	interrupt(): void;
}

/** 250 ms, matching Obsidian: longer reverts entire half-words at typical typing speeds. */
export const UNDO_DEBOUNCE_MS = 250;

export function createTextBatch(deps: TextBatchDeps): TextBatch {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastBatchKey: string | number = -1;
	let needsCheckpoint = true;
	let batchPath: number[] | null = null;
	let batchByteLength = 0;

	/**
	 * Must run before the batch is repointed or reset, else edit-channel observers
	 * never see the batch's `input` event and under-count keystrokes.
	 */
	function flushPendingInput(): void {
		if (batchByteLength > 0 && batchPath) {
			deps.emitInput(batchPath, batchByteLength);
		}
		batchPath = null;
		batchByteLength = 0;
	}

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
				flushPendingInput();
				deps.pushSnapshot(leafPath, offset);
				lastBatchKey = key;
				batchPath = leafPath.slice();
				needsCheckpoint = false;
			}
			batchByteLength++;
			clearTimer();
			// Wall-clock pause detection, not async sequencing (G4.4 allowlist):
			// tick() is microtask-grained and can't express "stopped typing ~250ms".
			timer = setTimeout(() => {
				needsCheckpoint = true;
				timer = null;
				flushPendingInput();
			}, UNDO_DEBOUNCE_MS);
		},
		interrupt() {
			clearTimer();
			flushPendingInput();
			needsCheckpoint = true;
		}
	};
}

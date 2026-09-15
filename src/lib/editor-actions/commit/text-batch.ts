/**
 * Keystroke batching: one undo entry per burst of typing, ended by a pause, a change of
 * batch key, or a structural commit. Snapshot capture stays with the controller, injected.
 */

export interface TextBatchDeps {
	/** Capture the pre-edit snapshot for the first keystroke of a batch. */
	pushSnapshot(leafPath: number[], offset: number): void;
	/** Emit the batched `input` edit event when a batch flushes. Omitted by a batch with no edit
	 *  events of its own: a revealed source's bytes are reported once, when it collapses. */
	emitInput?(leafPath: number[], byteLength: number): void;
}

export interface TextBatch {
	/**
	 * The first keystroke of a batch pushes a snapshot. `batchKey` identifies the leaf
	 * being typed in, so sibling leaves never share a batch across a focus move.
	 */
	keystroke(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Start the pause timer, called once the keystroke's own edit has finished. Separate from
	 * `keystroke` because the timer measures the pause the user leaves, not the pause plus the
	 * editor's own work: started earlier, a keystroke whose processing takes about as long as
	 * the timer would open a fresh batch every time, one undo entry per character. Does
	 * nothing without a live batch.
	 */
	armPause(): void;
	/**
	 * Called by a structural commit: cancel the pause timer, flush the pending input event,
	 * and make the next keystroke push a fresh snapshot.
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
	 * Must run before the batch is repointed or reset, or edit-event listeners never see
	 * the batch's `input` event and under-count keystrokes.
	 */
	function flushPendingInput(): void {
		if (batchByteLength > 0 && batchPath) {
			deps.emitInput?.(batchPath, batchByteLength);
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
		},
		armPause() {
			if (needsCheckpoint) return;
			clearTimer();
			// A real-time pause, not async sequencing (G4.4 allowlist): tick() is a microtask
			// and cannot express "stopped typing for 250 ms".
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

/**
 * Keystroke-batch lifecycle for the undo controller: one undo entry per burst
 * of typing, broken by a wall-clock pause, a batch-key change, or a structural
 * commit. Owns the debounce timer and the pending input-event batch; snapshot
 * capture itself stays with the controller (injected).
 */

export interface TextBatchDeps {
	/** Capture the pre-edit snapshot for the first keystroke of a batch. */
	pushSnapshot(leafPath: number[], offset: number): void;
	/** Emit the batched `input` edit event when a batch flushes. */
	emitInput(leafPath: number[], byteLength: number): void;
}

export interface TextBatch {
	/**
	 * Record one keystroke. The first keystroke of a batch (new batch key, or
	 * after an interrupt/flush) pushes a snapshot; every keystroke re-arms the
	 * pause timer. `leafPath` is the edited leaf's doc-absolute path (snapshot
	 * seed + input-event target). `batchKey` identifies the leaf being typed in
	 * (stable string id for container scopes; the path itself as fallback) —
	 * sibling leaves inside one container must not share a batch across focus
	 * moves.
	 */
	keystroke(leafPath: number[], offset: number, batchKey?: string | number): void;
	/**
	 * Structural-commit interrupt: cancel the pause timer, flush the pending
	 * input event, and require a fresh snapshot from the next keystroke.
	 */
	interrupt(): void;
}

/**
 * 500 ms reverted entire half-words at typical typing speeds; 250 ms roughly
 * matches Obsidian. Word-boundary flushing is a potential refinement.
 */
export const UNDO_DEBOUNCE_MS = 250;

export function createTextBatch(deps: TextBatchDeps): TextBatch {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastBatchKey: string | number = -1;
	let needsCheckpoint = true;
	let batchPath: number[] | null = null;
	let batchByteLength = 0;

	/**
	 * Must run before the batch is repointed or reset — otherwise edit-channel
	 * observers never see the batch's `input` event and under-count keystrokes.
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

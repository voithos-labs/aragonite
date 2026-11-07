/**
 * Keystroke batching: one undo entry per burst of typing, ended by a pause, a change of
 * batch key, or a structural commit. The batch groups undo steps only; each keystroke's `edit`
 * fires at its own write (`leaf-commit.ts`). Snapshot capture stays with the controller, injected.
 */

import { devChecksOn } from '@voithos-labs/aragonite/dev-checks';

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

// In a dev build, every batch between its first keystroke and its end, so a test can end them all.
const openBatches = new Set<TextBatch>();
let pausesHeld = false;

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

	const batch: TextBatch = {
		keystroke(leafPath, offset, batchKey) {
			const key = batchKey ?? leafPath.join('.');
			if (lastBatchKey !== key || needsCheckpoint) {
				deps.pushSnapshot(leafPath, offset);
				lastBatchKey = key;
				needsCheckpoint = false;
				if (devChecksOn) openBatches.add(batch);
			}
		},
		armPause() {
			if (needsCheckpoint) return;
			clearTimer();
			if (pausesHeld) return;
			// A real-time pause, not async sequencing (G4.4 allowlist): tick() is a microtask
			// and cannot express "stopped typing for 250 ms".
			timer = setTimeout(batch.interrupt, UNDO_DEBOUNCE_MS);
		},
		interrupt() {
			clearTimer();
			needsCheckpoint = true;
			openBatches.delete(batch);
			deps.onEnd?.();
		}
	};
	return batch;
}

// ── Test control ─────────────────────────────────────────────────────────

/** Test-only, and refused outside dev checks: while held, a typing batch never ends on a pause,
 *  only when a test ends it or the editor interrupts it. Returns whether the hold took. */
export function holdTypingPausesForTests(): boolean {
	if (!devChecksOn) return false;
	pausesHeld = true;
	return true;
}

/** Test-only: back to the real pause, ending whatever the hold kept open. */
export function releaseTypingPausesForTests(): void {
	endTypingBatchesForTests();
	pausesHeld = false;
}

/** Test-only: end every open typing batch now, the way its pause would. */
export function endTypingBatchesForTests(): void {
	for (const batch of [...openBatches]) batch.interrupt();
}

/** Test-only: how many typing batches are open, so a test can wait for a pause to end one. */
export function openTypingBatchCountForTests(): number {
	return openBatches.size;
}

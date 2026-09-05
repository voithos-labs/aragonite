import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextBatch, UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';

function harness() {
	const pushSnapshot = vi.fn();
	const emitInput = vi.fn();
	const batch = createTextBatch({ pushSnapshot, emitInput });
	return { batch, pushSnapshot, emitInput };
}

describe('text-batch lifecycle', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('first keystroke pushes a snapshot; the rest of the burst does not', () => {
		const { batch, pushSnapshot } = harness();
		batch.keystroke([2], 5);
		batch.keystroke([2], 6);
		batch.keystroke([2], 7);
		expect(pushSnapshot).toHaveBeenCalledTimes(1);
		expect(pushSnapshot).toHaveBeenCalledWith([2], 5);
	});

	it('pause flush emits one input event with the batch byte count, next keystroke re-snapshots', () => {
		const { batch, pushSnapshot, emitInput } = harness();
		batch.keystroke([1], 0);
		batch.armPause();
		batch.keystroke([1], 1);
		batch.armPause();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS);
		expect(emitInput).toHaveBeenCalledTimes(1);
		expect(emitInput).toHaveBeenCalledWith([1], 2);
		batch.keystroke([1], 2);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});

	// Miss-analysis (#71): every case armed the pause inside `keystroke`, so nothing could tell
	// a window that starts when the user stops typing from one that starts when the editor starts
	// working — and on a host where a keystroke's own settle approaches 250ms those are the
	// difference between one undo entry per burst and one per character.
	it('the window opens at the arm, not at the keystroke: a slow settle spends no budget', () => {
		const { batch, pushSnapshot } = harness();
		batch.keystroke([1], 0);
		// The keystroke's own processing, longer than the whole window.
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS * 2);
		batch.armPause();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS - 1);

		batch.keystroke([1], 1);
		expect(pushSnapshot, 'the burst stayed one batch').toHaveBeenCalledTimes(1);
	});

	it('arming with no live batch starts no window', () => {
		const { batch, emitInput } = harness();
		batch.armPause();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS);
		expect(emitInput).not.toHaveBeenCalled();
	});

	it('batch-key change flushes the displaced batch and starts a new one (0.7.7 regression)', () => {
		const { batch, pushSnapshot, emitInput } = harness();
		batch.keystroke([0, 0], 0, 'leaf-a');
		batch.keystroke([0, 0], 1, 'leaf-a');
		batch.keystroke([0, 1], 0, 'leaf-b');
		expect(emitInput).toHaveBeenCalledWith([0, 0], 2);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});

	it('path fallback key: a different leaf path breaks the batch and flushes the displaced one', () => {
		const { batch, pushSnapshot, emitInput } = harness();
		batch.keystroke([0], 0);
		batch.keystroke([1], 0);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
		// Flush-before-repoint: the displaced batch's OWN path is emitted.
		expect(emitInput).toHaveBeenCalledWith([0], 1);
	});

	it('interrupt flushes the pending input and forces a fresh snapshot', () => {
		const { batch, pushSnapshot, emitInput } = harness();
		batch.keystroke([3], 4);
		batch.interrupt();
		expect(emitInput).toHaveBeenCalledWith([3], 1);
		batch.keystroke([3], 5);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});

	it('interrupt with no pending batch emits nothing', () => {
		const { batch, emitInput } = harness();
		batch.interrupt();
		expect(emitInput).not.toHaveBeenCalled();
	});

	it('the flushed path is the batch-start path, immune to later caller mutation', () => {
		const { batch, emitInput } = harness();
		const path = [0, 2];
		batch.keystroke(path, 0);
		path[1] = 9;
		batch.interrupt();
		expect(emitInput).toHaveBeenCalledWith([0, 2], 1);
	});
});

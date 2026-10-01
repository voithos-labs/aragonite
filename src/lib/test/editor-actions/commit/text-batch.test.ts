import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTextBatch, UNDO_DEBOUNCE_MS } from '$lib/editor-actions/commit/text-batch';

function harness() {
	const pushSnapshot = vi.fn();
	const onEnd = vi.fn();
	const batch = createTextBatch({ pushSnapshot, onEnd });
	return { batch, pushSnapshot, onEnd };
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

	it('a pause ends the batch, so the next keystroke re-snapshots', () => {
		const { batch, pushSnapshot, onEnd } = harness();
		batch.keystroke([1], 0);
		batch.armPause();
		batch.keystroke([1], 1);
		batch.armPause();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS - 1);
		batch.keystroke([1], 2);
		expect(pushSnapshot).toHaveBeenCalledTimes(1);

		batch.armPause();
		vi.advanceTimersByTime(UNDO_DEBOUNCE_MS);
		expect(onEnd).toHaveBeenCalledTimes(1);
		batch.keystroke([1], 3);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});

	// Miss-analysis (GH #71): every case started the pause timer inside a fast `keystroke`.
	it('the window opens at the branch, not at the keystroke: a slow settle spends no budget', () => {
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
		const { batch } = harness();
		batch.armPause();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('a batch-key change starts a new batch', () => {
		const { batch, pushSnapshot } = harness();
		batch.keystroke([0, 0], 0, 'leaf-a');
		batch.keystroke([0, 0], 1, 'leaf-a');
		batch.keystroke([0, 1], 0, 'leaf-b');
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
		expect(pushSnapshot).toHaveBeenLastCalledWith([0, 1], 0);
	});

	it('path fallback key: a different leaf path starts a new batch', () => {
		const { batch, pushSnapshot } = harness();
		batch.keystroke([0], 0);
		batch.keystroke([1], 0);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});

	it('interrupt cancels the pause timer and forces a fresh snapshot', () => {
		const { batch, pushSnapshot, onEnd } = harness();
		batch.keystroke([3], 4);
		batch.armPause();
		batch.interrupt();
		expect(vi.getTimerCount()).toBe(0);
		expect(onEnd).toHaveBeenCalledTimes(1);
		batch.keystroke([3], 5);
		expect(pushSnapshot).toHaveBeenCalledTimes(2);
	});
});

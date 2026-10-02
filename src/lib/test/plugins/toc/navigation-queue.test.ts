import { describe, it, expect } from 'vitest';
import { createNavigationQueue } from '$lib/plugins/toc/navigation-queue';
import { settleEditor } from '$lib/test/harness/settle';

// A navigation that leaves each call waiting on a promise the test resolves by hand, so the
// queue's ordering is visible one step at a time: `calls` records the path of every
// navigation actually issued, `resolveNext` completes the oldest.
function deferredNavigateTo() {
	const calls: number[][] = [];
	const resolvers: Array<() => void> = [];
	return {
		calls,
		navigateTo: (path: number[]) => {
			calls.push(path);
			return new Promise<void>((resolve) => resolvers.push(resolve));
		},
		resolveNext: () => resolvers.shift()?.()
	};
}

describe('createNavigationQueue', () => {
	it('runs one navigation at a time: a mid-flight navigate starts no concurrent one', async () => {
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

		void queue.navigateTo([1]);
		await settleEditor();
		expect(calls).toEqual([[1]]);

		// The one-at-a-time check: without it, navigateTo([2]) would fire here alongside
		// the first and fail.
		void queue.navigateTo([2]);
		await settleEditor();
		expect(calls).toEqual([[1]]);

		resolveNext();
		await settleEditor();
		expect(calls).toEqual([[1], [2]]);
	});

	it('supersedes the pending target: three rapid navigations scroll first then last, skipping the middle', async () => {
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

		void queue.navigateTo([1]);
		void queue.navigateTo([2]);
		void queue.navigateTo([3]);
		await settleEditor();
		expect(calls).toEqual([[1]]);

		resolveNext();
		await settleEditor();
		// Newest wins: the loop picks up [3], never the replaced [2].
		expect(calls).toEqual([[1], [3]]);

		resolveNext();
		await settleEditor();
		expect(calls).toEqual([[1], [3]]);
	});

	it('drains and resets, so a navigation after the queue empties issues promptly', async () => {
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

		void queue.navigateTo([1]);
		await settleEditor();
		resolveNext();
		await settleEditor();
		expect(calls).toEqual([[1]]);

		// The loop terminated and cleared `navigating`; a fresh navigate must fire at
		// once, not stall behind a stuck flag.
		void queue.navigateTo([9]);
		await settleEditor();
		expect(calls).toEqual([[1], [9]]);
	});
});

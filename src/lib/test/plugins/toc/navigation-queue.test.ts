import { describe, it, expect } from 'vitest';
import { createNavigationQueue } from '$lib/plugins/toc/navigation-queue';

// A scrollTo that parks each call on a promise the test resolves by hand, so the
// queue's serialization is observable one settle at a time: `calls` records the
// path of every scroll actually issued, `resolveNext` completes the oldest.
function deferredScrollTo() {
	const calls: number[][] = [];
	const resolvers: Array<() => void> = [];
	return {
		calls,
		scrollTo: (path: number[]) => {
			calls.push(path);
			return new Promise<void>((resolve) => resolvers.push(resolve));
		},
		resolveNext: () => resolvers.shift()?.()
	};
}

// Flush enough microtask turns for a resumed drain loop to issue its next scroll.
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('createNavigationQueue', () => {
	it('runs one scrollTo at a time — a mid-flight navigate starts no concurrent scroll', async () => {
		const { calls, scrollTo, resolveNext } = deferredScrollTo();
		const queue = createNavigationQueue({ scrollTo });

		void queue.navigateTo([1]);
		await settle();
		expect(calls).toEqual([[1]]);

		// A second navigate while the first scroll is still in flight must NOT issue a
		// concurrent scroll — this is the strict-serialization guard (the whole point
		// of the queue). Unserialized, scrollTo([2]) fires here and reddens.
		void queue.navigateTo([2]);
		await settle();
		expect(calls).toEqual([[1]]);

		resolveNext();
		await settle();
		expect(calls).toEqual([[1], [2]]);
	});

	it('supersedes the pending target: three rapid navigations scroll first then last, skipping the middle', async () => {
		const { calls, scrollTo, resolveNext } = deferredScrollTo();
		const queue = createNavigationQueue({ scrollTo });

		void queue.navigateTo([1]);
		void queue.navigateTo([2]);
		void queue.navigateTo([3]);
		await settle();
		expect(calls).toEqual([[1]]);

		resolveNext();
		await settle();
		// Latest-wins: the drain picks up [3] (the newest), never the superseded [2].
		expect(calls).toEqual([[1], [3]]);

		resolveNext();
		await settle();
		expect(calls).toEqual([[1], [3]]);
	});

	it('drains and resets, so a navigation after the queue empties issues promptly', async () => {
		const { calls, scrollTo, resolveNext } = deferredScrollTo();
		const queue = createNavigationQueue({ scrollTo });

		void queue.navigateTo([1]);
		await settle();
		resolveNext();
		await settle();
		expect(calls).toEqual([[1]]);

		// The loop terminated and cleared `navigating`; a fresh navigate must fire at
		// once, not stall behind a stuck flag.
		void queue.navigateTo([9]);
		await settle();
		expect(calls).toEqual([[1], [9]]);
	});
});

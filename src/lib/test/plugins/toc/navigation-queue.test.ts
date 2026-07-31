import { describe, it, expect } from 'vitest';
import { createNavigationQueue } from '$lib/plugins/toc/navigation-queue';

// A navigation that parks each call on a promise the test resolves by hand, so the
// queue's serialization is observable one settle at a time: `calls` records the
// path of every navigation actually issued, `resolveNext` completes the oldest.
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

// Flush enough microtask turns for a resumed drain loop to issue its next scroll.
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe('createNavigationQueue', () => {
	it('runs one navigation at a time — a mid-flight navigate starts no concurrent one', async () => {
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

		void queue.navigateTo([1]);
		await settle();
		expect(calls).toEqual([[1]]);

		// The strict-serialization guard: unserialized, navigateTo([2]) fires here
		// concurrently with the first and reddens.
		void queue.navigateTo([2]);
		await settle();
		expect(calls).toEqual([[1]]);

		resolveNext();
		await settle();
		expect(calls).toEqual([[1], [2]]);
	});

	it('supersedes the pending target: three rapid navigations scroll first then last, skipping the middle', async () => {
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

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
		const { calls, navigateTo, resolveNext } = deferredNavigateTo();
		const queue = createNavigationQueue({ navigateTo });

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

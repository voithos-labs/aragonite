/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '$lib/dev-warn';
import { createBoundedMemo } from '$lib/bounded-memo';

describe('createBoundedMemo', () => {
	it('computes once per key and returns the cached value by identity without cloneOnRead', () => {
		const value = { n: 1 };
		const compute = vi.fn(() => value);
		const memo = createBoundedMemo<string, { n: number }>({ cap: 4 });

		const first = memo('k', compute);
		const second = memo('k', compute);

		expect(compute).toHaveBeenCalledTimes(1);
		expect(first).toBe(value);
		expect(second).toBe(value);
	});

	// clone-on-read exists because a single DOM node cannot occupy two places: the
	// cache entry stays pristine and each caller gets its own detached clone.
	it('clones on every read when cloneOnRead is set; the compute still runs once', () => {
		const compute = vi.fn(() => {
			const dom = document.createElement('span');
			dom.textContent = 'x';
			return { dom };
		});
		const memo = createBoundedMemo<string, { dom: HTMLElement }>({
			cap: 4,
			cloneOnRead: (v) => ({ dom: v.dom.cloneNode(true) as HTMLElement })
		});

		const first = memo('k', compute);
		const second = memo('k', compute);

		expect(compute).toHaveBeenCalledTimes(1);
		expect(second.dom).not.toBe(first.dom);
		expect(first.dom.textContent).toBe('x');
		expect(second.dom.textContent).toBe('x');
	});

	// Membership, not truthiness, decides a hit — a cached falsy value must not
	// re-run the compute (the generalization's regression guard).
	it('caches a falsy value without recomputing', () => {
		const compute = vi.fn(() => '');
		const memo = createBoundedMemo<string, string>({ cap: 4 });

		memo('k', compute);
		memo('k', compute);

		expect(compute).toHaveBeenCalledTimes(1);
	});

	it('evicts the least-recently-used key past the cap; a hit refreshes recency', () => {
		const compute = vi.fn((k: string) => k.toUpperCase());
		const memo = createBoundedMemo<string, string>({ cap: 2 });
		const run = (k: string) => memo(k, () => compute(k));

		run('a');
		run('b');
		run('a'); // hit — 'a' becomes most recent
		expect(compute).toHaveBeenCalledTimes(2);

		run('c'); // evicts 'b' (LRU), not 'a'
		expect(compute).toHaveBeenCalledTimes(3);

		run('a'); // still cached
		expect(compute).toHaveBeenCalledTimes(3);
		run('b'); // evicted — recomputed
		expect(compute).toHaveBeenCalledTimes(4);
	});

	// Async is the same primitive with V = Promise: the in-flight promise is the
	// cached value, so a repeat before resolution shares it (no double render).
	it('dedupes in-flight async work: a repeat before resolution shares the promise', async () => {
		let resolve!: (v: string) => void;
		const compute = vi.fn(() => new Promise<string>((r) => (resolve = r)));
		const memo = createBoundedMemo<string, Promise<string>>({ cap: 4 });

		const first = memo('k', compute);
		const second = memo('k', compute);

		expect(second).toBe(first);
		expect(compute).toHaveBeenCalledTimes(1);

		resolve('done');
		expect(await first).toBe('done');
		expect(await second).toBe('done');
	});

	// A rejecting promise is cached verbatim — same failure for the same key, no
	// retry — mirroring the sync cache's error caching.
	it('caches a rejecting promise verbatim: one compute, the same rejected promise each call', async () => {
		const rejection = new Error('boom');
		const compute = vi.fn(() => Promise.reject(rejection));
		const memo = createBoundedMemo<string, Promise<never>>({ cap: 4 });

		const first = memo('k', compute);
		const second = memo('k', compute);

		// Attach handlers immediately so the runner never flags an unhandled rejection.
		await expect(first).rejects.toBe(rejection);
		await expect(second).rejects.toBe(rejection);
		expect(first).toBe(second);
		expect(compute).toHaveBeenCalledTimes(1);
	});
});

// `cap` is on the published plugin surface, so a nonsensical value must report
// rather than throw: cap 0 silently behaved as cap 1 (evict-then-insert), which
// reads as "caching is off" right up until a plugin author debugs a stale entry.
describe('createBoundedMemo with a non-positive cap', () => {
	it('dev-warns at creation and clamps to a usable cap', () => {
		vi.mocked(devWarn).mockClear();

		const memo = createBoundedMemo<string, number>({ cap: 0 });
		const compute = vi.fn(() => 1);
		memo('k', compute);
		memo('k', compute);

		expect(vi.mocked(devWarn)).toHaveBeenCalledTimes(1);
		expect(compute).toHaveBeenCalledTimes(1);
	});
});

import { describe, it, expect } from 'vitest';
import { createRegexExecutor } from '../../search/regex-executor';

// The runner has no `Worker` global, so every case here exercises the synchronous
// fallback — the path a CSP-restricted embedder and SSR also take. The worker path
// is driven by `e2e/tests/search/pathological-regex.spec.ts`.

const request = (texts: string[], pattern: string, epoch = 1) => ({
	texts,
	pattern,
	flags: 'g',
	epoch
});

// Catastrophic backtracking: ~2^n on a failing match. Sized so ONE text costs tens
// of milliseconds — comfortably past the deadline below, and short enough that the
// bail happens long before the runner's own timeout, under load or not.
const SLOW_PATTERN = '(a+)+$';
const SLOW_TEXT = `${'a'.repeat(22)}!`;

describe('createRegexExecutor — synchronous fallback', () => {
	it('returns one range list per text, in order, echoing the epoch', async () => {
		const executor = createRegexExecutor();
		const outcome = await executor.scan(request(['ab ab', 'zz', 'ab'], 'ab', 7));
		expect(outcome.ok).toBe(true);
		expect(outcome.epoch).toBe(7);
		if (!outcome.ok) return;
		expect(outcome.ranges.map((r) => r.length)).toEqual([2, 0, 1]);
		expect(outcome.ranges[0][1]).toMatchObject({ start: 3, end: 5 });
	});

	it('bails between texts once the deadline is spent', async () => {
		const executor = createRegexExecutor({ deadlineMs: 5 });
		const outcome = await executor.scan(request(Array(4).fill(SLOW_TEXT), SLOW_PATTERN));
		expect(outcome).toEqual({ ok: false, epoch: 1, reason: 'timeout' });
	});

	it('runs the first text whole, so a spent deadline never returns a vacuous timeout', async () => {
		// The between-texts check cannot fire before any work exists; a deadline of 0
		// must still produce the single text's real ranges.
		const executor = createRegexExecutor({ deadlineMs: 0 });
		const outcome = await executor.scan(request(['ab ab'], 'ab'));
		expect(outcome.ok).toBe(true);
		if (outcome.ok) expect(outcome.ranges[0]).toHaveLength(2);
	});

	it('reports an uncompilable pattern as a failed outcome rather than throwing', async () => {
		const executor = createRegexExecutor();
		const outcome = await executor.scan(request(['text'], '('));
		expect(outcome).toEqual({ ok: false, epoch: 1, reason: 'error' });
	});

	it('scans again after release', async () => {
		// release() frees the worker, it does not retire the executor — reopening the
		// find bar must not need a new one.
		const executor = createRegexExecutor();
		await executor.scan(request(['ab'], 'ab'));
		executor.release();
		const outcome = await executor.scan(request(['ab ab'], 'ab', 2));
		expect(outcome.ok).toBe(true);
		if (outcome.ok) expect(outcome.ranges[0]).toHaveLength(2);
	});

	it('carries capture groups through, so a $1 replacement can read them', async () => {
		const executor = createRegexExecutor();
		const outcome = await executor.scan(request(['2026-07-25'], '(\\d{4})-(\\d{2})'));
		expect(outcome.ok).toBe(true);
		if (outcome.ok) expect(outcome.ranges[0][0].groups).toEqual(['2026-07', '2026', '07']);
	});
});

import { describe, it, expect, vi, afterEach } from 'vitest';

import { takeDevWarns } from './support/warn-gate';
import { assertInvariant, type InvariantViolation } from '../assert';

describe('assertInvariant — dev-runtime channel', () => {
	afterEach(() => {
		vi.doUnmock('esm-env');
		vi.resetModules();
	});

	// The tag is namespaced `invariant:<tag>` so the e2e watchers can tell a violation
	// from a plain dev warning under the shared `[aragonite:…]` console sentinel.
	it('routes a violation to devWarn under the invariant namespace (non-crashing)', () => {
		const violation: InvariantViolation = { code: 'stale-raw', message: 'raw drifted' };
		expect(() => assertInvariant('test', () => violation)).not.toThrow();
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['invariant:test']);
		expect(fires[0].message).toBe('raw drifted');
		expect(fires[0].details).toBe('stale-raw');
	});

	it('passes violation.detail through when present', () => {
		assertInvariant('test', () => ({ code: 'x', message: 'm', detail: { n: 1 } }));
		const fires = takeDevWarns();
		expect(fires.map((w) => w.tag)).toEqual(['invariant:test']);
		expect(fires[0].message).toBe('m');
		expect(fires[0].details).toEqual({ n: 1 });
	});

	it('stays silent when the predicate returns null', () => {
		assertInvariant('test', () => null);
		expect(takeDevWarns()).toEqual([]);
	});

	// `DEV` is a build-time constant, so the production branch is reachable only by
	// re-importing the module against a false one.
	it('does not run the predicate in production', async () => {
		vi.resetModules();
		vi.doMock('esm-env', () => ({ DEV: false }));
		const production = await import('../assert');
		const check = vi.fn(() => null);
		production.assertInvariant('test', check);
		expect(check).not.toHaveBeenCalled();
	});
});

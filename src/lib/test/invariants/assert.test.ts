import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { assertInvariant, type InvariantViolation } from '../../invariants/assert';

describe('assertInvariant — dev-runtime channel', () => {
	beforeEach(() => vi.mocked(devWarn).mockClear());
	afterEach(() => {
		vi.doUnmock('esm-env');
		vi.resetModules();
	});

	// The tag is namespaced `invariant:<tag>` so the e2e simulation's error
	// collector can match violations via the `[invariant:` console marker.
	it('routes a violation to devWarn under the invariant namespace (non-crashing)', () => {
		const violation: InvariantViolation = { code: 'stale-raw', message: 'raw drifted' };
		expect(() => assertInvariant('test', () => violation)).not.toThrow();
		expect(devWarn).toHaveBeenCalledTimes(1);
		expect(devWarn).toHaveBeenCalledWith('invariant:test', 'raw drifted', 'stale-raw');
	});

	it('passes violation.detail through when present', () => {
		assertInvariant('test', () => ({ code: 'x', message: 'm', detail: { n: 1 } }));
		expect(devWarn).toHaveBeenCalledWith('invariant:test', 'm', { n: 1 });
	});

	it('stays silent when the predicate returns null', () => {
		assertInvariant('test', () => null);
		expect(devWarn).not.toHaveBeenCalled();
	});

	// `DEV` is a build-time constant, so the production branch is reachable only by
	// re-importing the module against a false one.
	it('does not run the predicate in production', async () => {
		vi.resetModules();
		vi.doMock('esm-env', () => ({ DEV: false }));
		const production = await import('../../invariants/assert');
		const check = vi.fn(() => null);
		production.assertInvariant('test', check);
		expect(check).not.toHaveBeenCalled();
	});
});

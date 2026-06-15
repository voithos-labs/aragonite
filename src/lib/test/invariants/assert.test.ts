import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../dev-warn', () => ({ devWarn: vi.fn() }));
import { devWarn } from '../../dev-warn';
import { assertInvariant, type InvariantViolation } from '../../invariants/assert';

describe('assertInvariant — dev-runtime channel', () => {
	beforeEach(() => {
		vi.stubEnv('DEV', true);
		vi.mocked(devWarn).mockClear();
	});
	afterEach(() => vi.unstubAllEnvs());

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

	it('does not run the predicate in production', () => {
		vi.stubEnv('DEV', false);
		const check = vi.fn(() => null);
		assertInvariant('test', check);
		expect(check).not.toHaveBeenCalled();
	});
});

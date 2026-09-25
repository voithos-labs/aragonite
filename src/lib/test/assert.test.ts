import { describe, it, expect, vi, afterEach } from 'vitest';

import { takeDevWarns } from './support/warn-gate';
import { assertInvariant, type InvariantViolation } from '../assert';

describe('assertInvariant: dev-runtime channel', () => {
	afterEach(() => {
		vi.doUnmock('esm-env');
		vi.resetModules();
	});

	// The tag is written `invariant:<tag>` so the e2e watchers can tell a violation from an
	// ordinary dev warning under the shared `[aragonite:…]` console prefix.
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

	// `DEV` is a build-time constant, so the production branch is reachable only by re-importing
	// the module with it set to false.
	it('does not run the predicate in production', async () => {
		vi.resetModules();
		vi.doMock('esm-env', () => ({ DEV: false }));
		const production = await import('../assert');
		const check = vi.fn(() => null);
		production.assertInvariant('test', check);
		expect(check).not.toHaveBeenCalled();
	});

	// Miss-analysis: every suite runs with DEV already true, so the published override was never
	// tried on a build where DEV is false, which is what a runner resolving no conditions gets.
	it('runs the predicate when configureEditorEnv turns dev on over a build where DEV is false', async () => {
		vi.resetModules();
		vi.doMock('esm-env', () => ({ DEV: false }));
		const { configureEditorEnv } = await import('../env');
		const { setDevWarnSink } = await import('../dev-warn');
		const overridden = await import('../assert');
		const fires: string[] = [];
		setDevWarnSink((entry) => fires.push(entry.tag));
		configureEditorEnv({ isDev: true });
		overridden.assertInvariant('test', () => ({ code: 'x', message: 'm' }));
		expect(fires).toEqual(['invariant:test']);
	});
});

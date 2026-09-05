// @vitest-environment jsdom
//
// Miss-analysis: the sink read only `devWarn`, so Svelte's own runtime warnings — which print
// through `console.warn` and nowhere else — were unobservable to every unit test.

import { describe, it, expect } from 'vitest';
import { takeDevWarns, allowDevWarns } from './support/warn-gate';
import { compareProxyToRaw } from './support/svelte-warn.svelte';

const emitSvelteWarn = (code: string): void =>
	console.warn(
		`%c[svelte] ${code}\n%cinjected ${code} fire`,
		'font-weight: bold',
		'font-weight: normal'
	);

describe('warn-gate svelte channel', () => {
	it('records Svelte’s own runtime warn under its code, with the emitting site', () => {
		compareProxyToRaw();
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].tag).toBe('svelte:state_proxy_equality_mismatch');
		expect(fires[0].site).toBe('src/lib/test/warn-gate-svelte.test.ts');
		expect(fires[0].message).toContain('different identities');
	});

	it('claims a svelte code through the same door every dev-warn tag takes', () => {
		emitSvelteWarn('derived_inert');
		expect(allowDevWarns(['svelte:derived_inert'])).toHaveLength(1);
		expect(takeDevWarns()).toEqual([]);
	});

	it('leaves a console warning that is not Svelte’s alone', () => {
		console.warn('[some-dependency] a warning from outside the editor');
		expect(takeDevWarns()).toEqual([]);
	});
});

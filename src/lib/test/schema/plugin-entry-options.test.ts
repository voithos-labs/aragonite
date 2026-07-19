import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	definePlugin,
	normalizePluginEntries,
	__resetInstalledPluginsForTests
} from '$lib/schema/plugin-install';
import { configureEditorEnv, resetEditorEnv } from '$lib/env';

beforeEach(() => __resetInstalledPluginsForTests());

describe('normalizePluginEntries', () => {
	const p = () => definePlugin({ name: 'p', setup() {} });
	const q = () => definePlugin({ name: 'q', setup() {} });

	it('accepts bare plugins and { plugin, options } entries', () => {
		const a = p();
		const b = q();
		const { plugins, optionsByName } = normalizePluginEntries([
			a,
			{ plugin: b, options: { n: 1 } }
		]);
		expect(plugins).toEqual([a, b]);
		expect(optionsByName.get('q')).toEqual({ n: 1 });
		expect(optionsByName.has('p')).toBe(false);
	});

	it('dev-warns on the same plugin listed twice; first entry wins', () => {
		const a = p();
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// devWarn no-ops in a test env; force dev-not-test so the warn is observable.
		configureEditorEnv({ isDev: true, isTest: false });
		try {
			const { plugins, optionsByName } = normalizePluginEntries([
				{ plugin: a, options: { n: 1 } },
				{ plugin: a, options: { n: 2 } }
			]);
			expect(plugins).toEqual([a]);
			expect(optionsByName.get('p')).toEqual({ n: 1 });
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0].join(' ')).toMatch(/listed twice/);
		} finally {
			resetEditorEnv();
			spy.mockRestore();
		}
	});
});

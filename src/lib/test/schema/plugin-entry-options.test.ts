import { describe, it, expect, beforeEach } from 'vitest';
import {
	definePlugin,
	normalizePluginEntries,
	__resetInstalledPluginsForTests
} from '$lib/schema/plugin-install';
import { takeDevWarns } from '../support/warn-gate';

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
		const { plugins, optionsByName } = normalizePluginEntries([
			{ plugin: a, options: { n: 1 } },
			{ plugin: a, options: { n: 2 } }
		]);
		expect(plugins).toEqual([a]);
		expect(optionsByName.get('p')).toEqual({ n: 1 });
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].message).toMatch(/listed twice/);
	});
});

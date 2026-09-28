// Miss-analysis: each built-in registry kept its own set of reset-surviving keys, and only those two
// sets had tests, so a third registry needing a core entry had no shared route to test.
import { describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { activationFor } from '$lib/schema/plugin-activation';
import { createBlockKindRegistry, createPluginRegistry } from '$lib/schema/plugin-registry';

const registry = createPluginRegistry<string, string>({
	label: 'registerProbe',
	isBuiltin: () => false
});

// Never called: `npm run check` is the gate. A kind's entries answer to its declarer, so a kind
// registry offers no way to hand one to no plugin.
const typePins = (): void => {
	const kinds = createBlockKindRegistry<true>({ label: 'pin', isBuiltin: () => false });
	// @ts-expect-error a kind registry has no core registration
	kinds.registerCore('paragraph', true);
};
void typePins;

describe('a core registration', () => {
	it('is owned by no plugin, even from inside a plugin’s setup', () => {
		installPlugins([
			definePlugin({
				name: 'reacher',
				setup() {
					registry.registerCore('core-entry', 'core');
					registry.register('plugin-entry', 'plugin');
				}
			})
		]);
		expect(registry.ownerOf('core-entry')).toBeNull();
		expect(registry.ownerOf('plugin-entry')).toBe('reacher');
		expect(registry.get('core-entry', activationFor([]))).toBe('core');
	});

	it('survives the test reset, which drops the plugin’s own entry', () => {
		installPlugins([
			definePlugin({
				name: 'reacher',
				setup() {
					registry.registerCore('kept', 'core');
					registry.register('dropped', 'plugin');
				}
			})
		]);
		resetPluginPlatformForTests();
		expect(registry.has('kept')).toBe(true);
		expect(registry.has('dropped')).toBe(false);
	});
});

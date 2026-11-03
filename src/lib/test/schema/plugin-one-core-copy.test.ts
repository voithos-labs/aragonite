// A plugin package that resolves its own copy of the core registers into that copy's registries,
// which the editor never reads; installing it warns in dev instead of failing quietly (G1.166).
// Miss-analysis: every plugin test defined and installed through one module graph, so two copies of
// the core never met.
import { describe, it, expect, vi } from 'vitest';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

const TAG = 'invariant:plugin-one-core-copy';
const tagsOf = () => takeDevWarns().map((warn) => warn.tag);

/** `definePlugin` from a second copy of the core: the module graph loaded again from scratch. */
async function secondCopyDefinePlugin(): Promise<typeof definePlugin> {
	vi.resetModules();
	return (await import('#lib/schema/plugin-install.js')).definePlugin;
}

describe('G1.166 a plugin defined by another copy of the core warns at install', () => {
	it('warns for a plugin another copy defined', async () => {
		const defineElsewhere = await secondCopyDefinePlugin();
		installPlugins([defineElsewhere({ name: 'from-another-copy', setup() {} })]);
		expect(tagsOf()).toEqual([TAG]);
	});

	it('stays quiet for a plugin this copy defined', () => {
		installPlugins([definePlugin({ name: 'from-this-copy', setup() {} })]);
		expect(tagsOf()).toEqual([]);
	});

	it('stays quiet for a plugin object built by hand, which names no copy', () => {
		installPlugins([{ name: 'built-by-hand', setup() {} }]);
		expect(tagsOf()).toEqual([]);
	});

	it('still defines a frozen plugin, which it cannot mark', () => {
		const frozen = Object.freeze({ name: 'frozen-plugin', setup() {} });
		expect(definePlugin(frozen)).toBe(frozen);
	});
});

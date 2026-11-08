// The plugin value `definePlugin` returns for a spec with `contributes`.
import { describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { isPluginValue } from '#lib/schema/plugin-unit.js';
import { qualifiedName } from '#lib/schema/plugin-name.js';

const spec = {
	name: 'math',
	version: '2.1.0',
	editor: '^0.11.0',
	defaults: { render: 'svg', inline: true },
	contributes: () => ({})
};

describe('a plugin value', () => {
	it('carries its identity, and calling it keeps that identity', () => {
		const math = definePlugin(spec);
		const configured = math({ render: 'html' });
		for (const p of [math, configured]) {
			expect([p.name, p.version, p.editor]).toEqual(['math', '2.1.0', '^0.11.0']);
			expect(p.defaults).toEqual({ render: 'svg', inline: true });
			expect(isPluginValue(p)).toBe(true);
		}
		expect(configured).not.toBe(math);
	});

	it('rejects an invalid name at definition', () => {
		expect(() => definePlugin({ ...spec, name: 'Math' })).toThrow(/invalid plugin name "Math"/);
	});

	it('is told apart from a setup plugin', () => {
		const old = definePlugin({ name: 'old', setup: () => {} });
		expect(isPluginValue(old)).toBe(false);
	});
});

describe('qualified names', () => {
	it('puts the plugin name in front of a local name, and refuses an invalid local name', () => {
		expect(qualifiedName('callouts', 'callout')).toBe('callouts/callout');
		expect(() => qualifiedName('callouts', 'Call out')).toThrow(/invalid name "Call out"/);
	});
});

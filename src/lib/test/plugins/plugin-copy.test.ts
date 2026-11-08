// The package check's reading of a plugin package's exports: a `setup` plugin's factory, or a plugin
// value, and a value another copy of the core defined.
import { describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/plugin.js';
import { fromAnotherCopy, pluginExports } from '../../../../scripts/pack/plugin-copy.mjs';

const value = definePlugin({
	name: 'copy-value',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({})
});
const factory = () => definePlugin({ name: 'copy-setup', setup: () => {} });

describe('pluginExports', () => {
	it('tells factories from plugin values, and reads only the `*Plugin` exports', () => {
		const { factories, values } = pluginExports({
			valuePlugin: value,
			setupPlugin: factory,
			helper: () => 1
		});
		expect(factories.map(([name]) => name)).toEqual(['setupPlugin']);
		expect(values.map(([name]) => name)).toEqual(['valuePlugin']);
	});
});

describe('fromAnotherCopy', () => {
	const probe = definePlugin({
		name: 'probe',
		version: '0.0.0',
		editor: '*',
		contributes: () => ({})
	});

	it('passes a value this copy of the core defined', () => {
		expect(fromAnotherCopy([['valuePlugin', value]], probe)).toEqual([]);
	});

	it('names a value carrying another copy’s mark', () => {
		const stray = Object.assign(() => {}, {
			[Symbol.for('@voithos-labs/aragonite:plugin-unit')]: {},
			[Symbol.for('@voithos-labs/aragonite:defined-by')]: { version: 'another' }
		});
		expect(fromAnotherCopy([['strayPlugin', stray]], probe)).toEqual(['strayPlugin']);
	});
});

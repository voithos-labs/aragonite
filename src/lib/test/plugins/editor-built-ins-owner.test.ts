// Miss-analysis: the built-in tests reached the editor's bootstraps outside any plugin, so a
// kind-keyed built-in that a plugin's setup reached first answering to that plugin never showed.
import { describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { blockViewFor } from '#lib/schema/block-kind-descriptor.js';
import { getPasteSurface } from '#lib/tree-operations/paste-surfaces.js';
import { registerEditorBuiltIns } from '#lib/components/editor-built-ins.js';

const noPlugins = activationFor([]);
const builtInsResolve = () => {
	expect(blockViewFor('paragraph', noPlugins)).toBeDefined();
	expect(getPasteSurface('tableCell', noPlugins)).toBeDefined();
};

describe('the editor’s built-ins, reached first from a plugin’s setup', () => {
	it('belong to no plugin and survive the test reset', () => {
		installPlugins([definePlugin({ name: 'early', setup: registerEditorBuiltIns })]);
		builtInsResolve();
		resetPluginPlatformForTests();
		builtInsResolve();
	});
});

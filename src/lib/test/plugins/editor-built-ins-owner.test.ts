// Miss-analysis: the built-in tests reached the editor's bootstraps outside any plugin, so a
// kind-keyed built-in that a plugin's setup reached first answering to that plugin never showed.
import { describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '#lib/testing.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { getBlockComponent } from '#lib/schema/block-component-registry.js';
import { getPasteSurface } from '#lib/tree-operations/paste-surfaces.js';
import { listLanguages } from '#lib/components/blocks/code/code-languages.js';
import { registerEditorBuiltIns } from '#lib/components/editor-built-ins.js';

const noPlugins = activationFor([]);
const builtInsResolve = () => {
	expect(getBlockComponent('paragraph', noPlugins)).toBeDefined();
	expect(getPasteSurface('fencedCode', noPlugins)).toBeDefined();
	expect(getPasteSurface('tableCell', noPlugins)).toBeDefined();
	expect(listLanguages(noPlugins)).toContain('python');
};

describe('the editor’s built-ins, reached first from a plugin’s setup', () => {
	it('belong to no plugin and survive the test reset', () => {
		installPlugins([definePlugin({ name: 'early', setup: registerEditorBuiltIns })]);
		builtInsResolve();
		resetPluginPlatformForTests();
		builtInsResolve();
	});
});

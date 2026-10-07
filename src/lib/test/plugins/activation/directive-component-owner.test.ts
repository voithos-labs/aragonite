// Miss-analysis: no test turned directives on from inside a plugin's setup, so nothing showed
// whether the generic components belong to that plugin or to no plugin.
import { describe, expect, it } from 'vitest';
import { activateDirectives } from '#lib/plugin.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { activationFor } from '#lib/schema/plugin-activation.js';
import { createRegistryView } from '#lib/schema/registry-view.js';
import { declaredPluginKind } from '#lib/schema/plugin-kind.js';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '#lib/core/directive/kinds.js';

describe('directives turned on from inside a plugin’s setup', () => {
	it('draw their generic blocks in an editor that leaves that plugin out', () => {
		installPlugins([definePlugin({ name: 'turns-on-directives', setup: activateDirectives })]);
		const view = createRegistryView({ plugins: activationFor([]) });
		expect(view.component(declaredPluginKind(DIRECTIVE_CONTAINER))).toBeDefined();
		expect(view.component(declaredPluginKind(DIRECTIVE_LEAF))).toBeDefined();
	});
});

// Miss-analysis: no test turned directives on from inside a plugin's setup, so nothing showed
// whether the generic components belong to that plugin or to no plugin.
import { afterEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { activateDirectives } from '$lib/plugin';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { activationFor } from '$lib/schema/plugin-activation';
import { createRegistryView } from '$lib/schema/registry-view';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { DIRECTIVE_CONTAINER, DIRECTIVE_LEAF } from '$lib/core/directive/kinds';

afterEach(resetPluginPlatformForTests);

describe('directives turned on from inside a plugin’s setup', () => {
	it('draw their generic blocks in an editor that leaves that plugin out', () => {
		installPlugins([definePlugin({ name: 'turns-on-directives', setup: activateDirectives })]);
		const view = createRegistryView({ plugins: activationFor([]) });
		expect(view.component(declaredPluginKind(DIRECTIVE_CONTAINER))).toBeDefined();
		expect(view.component(declaredPluginKind(DIRECTIVE_LEAF))).toBeDefined();
	});
});

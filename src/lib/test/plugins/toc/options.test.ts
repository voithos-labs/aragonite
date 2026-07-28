import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetInstalledPluginsForTests } from '$lib/schema/plugin-install';
import { getBlockComponent } from '$lib/schema/block-component-registry';
import { declaredPluginKind } from '$lib/schema/plugin-kind';
import { tocPlugin, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';

// The install latch is separate from the schema registries: reset both so each
// case installs a fresh tocPlugin with its own option.
function reset(): void {
	__resetSchemaRegistriesForTests();
	__resetInstalledPluginsForTests();
}
beforeEach(reset);
afterEach(reset);

// `maxDepth` is a definition-time option threaded to the component as a constant
// extraProp — this pins the produced `tocPlugin({ maxDepth })` interface end to end
// (factory arg → extraProps closure → component prop), which the walk/e2e (fixed at
// the default 6) never exercises.
describe('tocPlugin maxDepth option', () => {
	function tocExtraProps(): Record<string, unknown> | undefined {
		const kind = declaredPluginKind(TOC_BLOCK);
		return getBlockComponent(kind)?.extraProps?.({ kind, leadingTrivia: '', raw: '[[toc]]\n' });
	}

	it('threads a configured maxDepth to the component', () => {
		installPlugins([tocPlugin({ maxDepth: 2 })]);
		expect(tocExtraProps()).toEqual({ maxDepth: 2 });
	});

	it('defaults to 6 (all levels) when no option is given', () => {
		installPlugins([tocPlugin()]);
		expect(tocExtraProps()).toEqual({ maxDepth: 6 });
	});
});

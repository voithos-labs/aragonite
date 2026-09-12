import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { installPlugins } from '$lib';
import { declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests } from '$lib/testing';
import { getBlockComponent } from '$lib/schema/block-component-registry';
import { tocPlugin, TOC_BLOCK } from '$lib/plugins/toc/toc-plugin';

beforeEach(resetPluginPlatformForTests);
afterEach(resetPluginPlatformForTests);

// Pins `tocPlugin({ maxDepth })` from factory arg through the extraProps closure to the
// component prop — the bare-install default. Per-instance depth is per-instance-depth.test.ts.
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

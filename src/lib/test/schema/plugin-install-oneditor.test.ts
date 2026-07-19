import { describe, it, expect, beforeEach } from 'vitest';
import {
	definePlugin,
	installPlugins,
	onEditorCallbacks,
	installedPluginNames,
	__resetInstalledPluginsForTests,
	type PluginSetupContext
} from '$lib/schema/plugin-install';

beforeEach(() => __resetInstalledPluginsForTests());

describe('onEditor subscription seam', () => {
	it('records callbacks per plugin, in registration order', () => {
		const calls: string[] = [];
		installPlugins([
			definePlugin({
				name: 'alpha',
				setup(ctx: PluginSetupContext) {
					// Block bodies: an expression-body arrow would return the push count
					// (number), which isn't assignable to the disposer union void | (() => void).
					ctx.onEditor(() => {
						calls.push('a1');
					});
					ctx.onEditor(() => {
						calls.push('a2');
					});
				}
			})
		]);
		expect(onEditorCallbacks('alpha')).toHaveLength(2);
		expect(onEditorCallbacks('missing')).toHaveLength(0);
	});

	it('throws when onEditor is called after setup returns (synchronous-only)', () => {
		let leaked: PluginSetupContext | undefined;
		installPlugins([
			definePlugin({
				name: 'leaky',
				setup(ctx) {
					leaked = ctx;
				}
			})
		]);
		expect(() => leaked!.onEditor(() => {})).toThrow(/synchronous|during setup/i);
	});

	it('no-arg legacy setup still installs', () => {
		installPlugins([definePlugin({ name: 'legacy', setup() {} })]);
		expect(installedPluginNames()).toContain('legacy');
	});

	it('reset clears subscriptions', () => {
		installPlugins([
			definePlugin({
				name: 'gone',
				setup(ctx) {
					ctx.onEditor(() => {});
				}
			})
		]);
		__resetInstalledPluginsForTests();
		expect(onEditorCallbacks('gone')).toHaveLength(0);
	});

	it('a setup that throws after onEditor leaves no orphaned subscriptions and blocks re-install', () => {
		const plugin = definePlugin({
			name: 'boom',
			setup(ctx) {
				ctx.onEditor(() => {});
				throw new Error('setup exploded');
			}
		});
		expect(() => installPlugins([plugin])).toThrow(/setup exploded/);
		// The install never completes, so its callback must not survive to run against
		// a later mount — the catch in installOne clears the plugin's subscriptions.
		expect(onEditorCallbacks('boom')).toHaveLength(0);
		// A partial setup can't be re-run: the second attempt reports the prior failure.
		expect(() => installPlugins([plugin])).toThrow(/failed during a previous install/);
	});
});

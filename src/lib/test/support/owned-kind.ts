import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import type { PluginBlockKind } from '$lib/core/nodes';

/** Declare `name` from inside an install of a plugin called `plugin`, so that plugin owns it. */
export function declareOwnedKind(plugin: string, name: string): PluginBlockKind {
	let kind: PluginBlockKind | undefined;
	installPlugins([
		definePlugin({ name: plugin, setup: () => void (kind = declarePluginKind(name)) })
	]);
	return kind!;
}

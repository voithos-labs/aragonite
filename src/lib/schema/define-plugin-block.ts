/**
 * The one-block plugin shortcut: declare and describe a kind, then attach its component, so a
 * single-kind plugin does not have to wrap `definePlugin` itself and get the setup order right. A
 * plugin with several kinds uses `definePlugin` directly. `kind` is the plain declared name,
 * branded after `register` runs: `declaredPluginKind` throws for a name not yet declared.
 */

import type { Component } from 'svelte';
import { definePlugin, type EditorPlugin } from './plugin-install';
import { declaredPluginKind } from './plugin-kind';
import { registerBlockComponent, defineBlockComponent } from './block-component-registry';
import type { BlockComponentExports, BlockComponentProps } from '../block-component';

export function definePluginBlock<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(config: {
	name: string;
	kind: string;
	component: Component<P, BlockComponentExports>;
	register: () => void;
}): EditorPlugin {
	return definePlugin({
		name: config.name,
		setup() {
			config.register();
			registerBlockComponent(
				declaredPluginKind(config.kind),
				defineBlockComponent(config.component)
			);
		}
	});
}

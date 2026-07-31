/**
 * The single-block plugin unit: declare-and-describe a kind, then bind its component, sparing a
 * one-kind plugin the register/define double-wrap and its setup ordering. A multi-kind plugin
 * stays on `definePlugin` directly. `kind` is the plain declared-kind NAME, branded lazily after
 * `register` runs — `declaredPluginKind` throws for a not-yet-declared name.
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

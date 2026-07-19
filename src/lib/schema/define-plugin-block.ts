/**
 * The single-block plugin unit: declare-and-describe a kind, then bind its
 * component. Wraps `definePlugin` around the two calls every one-kind plugin
 * (callout, details, mermaid, admonitions) makes, so the author writes neither the
 * `registerBlockComponent(declaredPluginKind(kind), defineBlockComponent(cmp))`
 * double-wrap nor its setup-then-register ordering. A multi-kind plugin (inline +
 * block) stays on `definePlugin` directly.
 *
 * `kind` is the plain declared-kind NAME, branded lazily after `register` runs —
 * `declaredPluginKind` throws for a not-yet-declared name, so it cannot be
 * evaluated at plugin-construction time before `register` declares the kind.
 */

import type { Component } from 'svelte';
import { definePlugin, type EditorPlugin } from './plugin-install';
import { declaredPluginKind } from './plugin-kind';
import { registerBlockComponent, defineBlockComponent } from './block-component-registry';
import type { BlockComponent, BlockComponentProps } from '../block-component';

export function definePluginBlock<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(config: {
	name: string;
	kind: string;
	component: Component<P, BlockComponent>;
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

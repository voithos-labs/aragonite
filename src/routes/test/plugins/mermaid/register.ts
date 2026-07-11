/**
 * The Mermaid plugin: the ```mermaid fence kind (grammar + metadata model,
 * registered by `registerMermaidKind`) plus the render-primary component. The
 * renderer is injected — `mermaidPlugin({ renderer })` — because the engine is
 * the consumer's dependency; absent one, the block renders its code statically.
 * The plugin unit installs this setup once per process, so it runs unguarded.
 */

import {
	definePlugin,
	registerBlockComponent,
	defineBlockComponent,
	declaredPluginKind,
	type EditorPlugin
} from '$lib/plugin';
import { registerMermaidKind, MERMAID } from './mermaid-kind';
import { setMermaidRenderer, type MermaidRenderer } from './mermaid-renderer';
import MermaidBlock from './MermaidBlock.svelte';

export function mermaidPlugin(options?: { renderer?: MermaidRenderer }): EditorPlugin {
	return definePlugin({
		name: 'mermaid',
		setup() {
			setMermaidRenderer(options?.renderer ?? null);
			registerMermaidKind();
			registerBlockComponent(declaredPluginKind(MERMAID), defineBlockComponent(MermaidBlock));
		}
	});
}

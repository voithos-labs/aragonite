/**
 * The renderer is injected because the engine is the consumer's dependency; absent
 * one the block renders its code statically. The plugin unit installs this setup once
 * per process, so it runs unguarded.
 */

import { definePluginBlock, type EditorPlugin } from '$lib/plugin';
import { registerMermaidKind, MERMAID } from './mermaid-kind';
import { setMermaidRenderer, type MermaidRenderer } from './mermaid-renderer';
import MermaidBlock from './MermaidBlock.svelte';

export function mermaidPlugin(options?: { renderer?: MermaidRenderer }): EditorPlugin {
	return definePluginBlock({
		name: 'mermaid',
		kind: MERMAID,
		component: MermaidBlock,
		register() {
			setMermaidRenderer(options?.renderer ?? null);
			registerMermaidKind();
		}
	});
}

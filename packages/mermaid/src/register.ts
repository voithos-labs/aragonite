/**
 * The renderer is passed in because mermaid is the consumer's dependency; without one the
 * block shows its code as plain text. The plugin installs this setup once per process, so it
 * runs unguarded.
 */

import {
	definePlugin,
	registerInsertEntry,
	type EditorPlugin
} from '@voithos-labs/aragonite/plugin';
import { svelteBlockView } from '@voithos-labs/aragonite/svelte';
import { registerMermaidKind } from './mermaid-kind';
import { adaptMermaidRenderer, mermaidSlot, type MermaidRenderer } from './mermaid-renderer';
import MermaidBlock from './MermaidBlock.svelte';

export function mermaidPlugin(options?: { renderer?: MermaidRenderer }): EditorPlugin {
	return definePlugin({
		name: 'mermaid',
		setup() {
			mermaidSlot.set(options?.renderer ? adaptMermaidRenderer(options.renderer) : null);
			registerMermaidKind(svelteBlockView(MermaidBlock));
			// Empty, since an empty diagram opens straight into its editor.
			registerInsertEntry({
				id: 'mermaid',
				label: 'Diagram',
				icon: 'workflow',
				keywords: ['mermaid', 'flowchart', 'chart', 'graph', 'sequence'],
				markdown: '```mermaid\n\n```\n'
			});
		}
	});
}

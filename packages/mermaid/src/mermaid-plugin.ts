/**
 * The mermaid plugin: a ```` ```mermaid ```` fence drawn as its diagram and edited in a box of its
 * own, through the renderer its options name (`mermaidRenderer` from `./renderer`, or your own).
 * Without one the block shows its code. Every editor running it keeps its own renderings.
 */
import {
	command,
	definePlugin,
	fencedBlock,
	type Block,
	type BoxDrawContext
} from '@voithos-labs/aragonite/plugin';
import { svelteBlock } from '@voithos-labs/aragonite/svelte';
import MermaidBlock from './MermaidBlock.svelte';
import { DIAGRAMS, mermaidRenders, type MermaidRenderer } from './mermaid-renderer';

export interface MermaidOptions {
	renderer?: MermaidRenderer;
}

/** What a diagram's drawing hands its type's commands. */
export interface DiagramUi {
	openEdit(): void;
	openFocusView(): void;
}

// No key of its own: the toolbar's Edit button is the way in, and a host binds one if it wants.
const edit = command<Block<never>, DiagramUi>({
	id: 'edit',
	title: 'Edit diagram',
	run: (_editor, _block, ui) => (ui ? ui.openEdit() : false)
});
const focus = command<Block<never>, DiagramUi>({
	id: 'focus',
	title: 'Focus diagram',
	run: (_editor, _block, ui) => (ui ? ui.openFocusView() : false)
});

export const mermaid = definePlugin<MermaidOptions>({
	name: 'mermaid',
	version: '0.11.5',
	editor: '0.11.5',
	contributes: ({ renderer }) => ({
		blocks: [
			fencedBlock({
				name: 'diagram',
				label: 'Diagram',
				dragLabel: 'Diagram',
				fence: { info: 'mermaid' },
				sample: '```mermaid\ngraph TD\n```',
				// Empty, since an empty diagram opens straight into its box.
				insert: {
					label: 'Diagram',
					icon: 'workflow',
					keywords: ['mermaid', 'flowchart', 'chart', 'graph', 'sequence'],
					insert: '```mermaid\n\n```\n'
				},
				// A drawn diagram stands far taller than a line; its measured height replaces this.
				height: () => 320,
				chords: { 'Mod+M': focus },
				commands: [edit],
				edit: 'box',
				draw: svelteBlock<never, BoxDrawContext, DiagramUi>(MermaidBlock, {
					context: new Map([[DIAGRAMS, mermaidRenders(renderer)]])
				})
			})
		]
	})
});

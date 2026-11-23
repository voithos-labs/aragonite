/**
 * A `[[toc]]` line drawn as the document's heading outline, each entry a link to its heading.
 * The outline reads each top-level block's headings through `depends`, so a key outside a heading
 * asks one block and redraws nothing. Without the plugin, `[[toc]]` is a plain paragraph.
 */

import { builtin, definePlugin, lineBlock } from '@voithos-labs/aragonite/plugin';
import { svelteBlock } from '@voithos-labs/aragonite/svelte';
import TocBlock from './TocBlock.svelte';
import { MAX_HEADING_DEPTH, headingsIn } from './heading-outline';

export type MaxHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** What an editor's `toc({ … })` sets. */
export interface TocOptions {
	/** Deepest heading level listed (default 6 = every level). */
	maxDepth?: MaxHeadingLevel;
}

/** A table of contents: list `toc`, or `toc({ maxDepth: 3 })`, in an editor's plugins. */
export const toc = definePlugin<TocOptions>({
	name: 'toc',
	version: '0.11.5',
	editor: '0.11.5',
	defaults: { maxDepth: MAX_HEADING_DEPTH },
	contributes: ({ maxDepth }) => ({
		blocks: [
			lineBlock({
				name: 'toc',
				label: 'Table of contents',
				match: /^\[\[toc\]\]$/,
				interrupts: true,
				// Ahead of the one built-in that reads brackets at a line's start.
				before: builtin.blocks.linkReferenceDefinition,
				sample: '[[toc]]',
				insert: {
					label: 'Table of contents',
					icon: 'list-tree',
					keywords: ['toc', 'contents', 'outline', 'index'],
					insert: '[[toc]]\n'
				},
				// A depth outside 1..6 lists every level rather than nothing.
				depends: headingsIn(isMaxHeadingLevel(maxDepth) ? maxDepth : MAX_HEADING_DEPTH),
				draw: svelteBlock(TocBlock)
			})
		]
	})
});

function isMaxHeadingLevel(value: unknown): value is MaxHeadingLevel {
	return (
		Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_HEADING_DEPTH
	);
}

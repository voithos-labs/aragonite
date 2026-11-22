/**
 * The highlight plugin: an editor that lists it paints fenced code with its renderer's tokens and
 * offers the renderer's languages in the code block's picker. Without a renderer it paints nothing.
 */
import { definePlugin, type CodeHighlighter } from '@voithos-labs/aragonite/plugin';

/** Makes one editor's highlighter; `highlightJs()` from `./renderer` is the bundled one. */
export type HighlightRenderer = () => CodeHighlighter;

export interface HighlightOptions {
	renderer?: HighlightRenderer;
}

export const highlight = definePlugin<HighlightOptions>({
	name: 'highlight',
	version: '0.11.5',
	editor: '0.11.5',
	defaults: {},
	contributes: ({ renderer }) => (renderer ? { code: renderer() } : {})
});

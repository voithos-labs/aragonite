// Inert dependencies for `createEditorPluginContexts`, so a test overrides only what it reads.
import { everyInstalledPlugin, type PluginActivation } from '$lib/schema/plugin-activation';
import type { DecorationRegistry } from '$lib/decorations/types';
import type { EditorRects } from '$lib/editor-rects';
import type { InlineMenuRegistry } from '$lib/inline-menu/types';
import type { InsertMarkdownOptions } from '$lib/editor-props';

export const noopDecorations: DecorationRegistry = {
	addSource: () => ({ invalidate() {}, dispose() {} })
};
export const noopRects: EditorRects = {
	blockRect: () => null,
	rangeRects: () => [],
	caretRect: () => null,
	reveal: async () => false,
	scrollTo: async () => false,
	navigateTo: async () => false
};
export const noopInlineMenus: InlineMenuRegistry = {
	addSource: () => ({ dispose() {} }),
	open: () => false,
	close() {},
	isOpen: false
};

export const pluginContextDeps = (doc: { children: unknown[] } = { children: [] }) => ({
	editorId: 'ed-1',
	getDoc: () => doc as never,
	events: { on: () => () => {} } as never,
	optionsFor: (() => undefined) as (pluginName: string) => unknown,
	decorations: noopDecorations,
	rects: noopRects,
	inlineMenus: noopInlineMenus,
	getDocumentGeneration: () => 0,
	getPresentationMode: () => 'source' as const,
	getTheme: () => 'dark',
	activation: everyInstalledPlugin as PluginActivation,
	insertMarkdown: (async () => false) as (
		md: string,
		options?: InsertMarkdownOptions
	) => Promise<boolean>,
	runCommand: (() => false) as (commandId: string, arg?: unknown) => boolean,
	computeInlineContent: () => []
});

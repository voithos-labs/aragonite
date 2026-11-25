// Inert dependencies for `createEditorPluginContexts`, so a test overrides only what it reads.
import { everyInstalledPlugin, type PluginActivation } from '#lib/schema/plugin-activation.js';
import type { DecorationRegistry } from '#lib/decorations/types.js';
import type { EditorRects } from '#lib/editor-rects.js';
import type { InlineMenuRegistry } from '#lib/inline-menu/types.js';
import type { InsertMarkdownOptions } from '#lib/editor-props.js';
import { kitReading } from '#lib/testing/kit-reading.js';
import type { InstalledPlugin, PluginError } from '#lib/schema/plugin-unit.js';
import type { Doc } from '#lib/schema/doc-view.js';
import type { View } from '#lib/schema/view.js';
import type { PluginEventReads } from '#lib/editor-events.js';
import type { Command } from '#lib/schema/plugin-command.js';
import { idleDraftRegistry } from './drafts';

const INERT_VIEW: View = {
	boxOf: () => null,
	boxesOf: () => [],
	caretBox: () => null,
	posAt: () => null,
	reveal: async () => false,
	overlay: () => () => {}
};

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

export const pluginContextDeps = (
	doc: { readonly children: readonly unknown[] } = { children: [] }
) => ({
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
	activationClick: () => false,
	activation: everyInstalledPlugin as PluginActivation,
	insertMarkdown: (async () => false) as (
		md: string,
		options?: InsertMarkdownOptions
	) => Promise<boolean>,
	runCommand: (() => false) as (
		command: Command<unknown, never> | string,
		arg?: unknown
	) => boolean,
	canRunCommand: (() => false) as (
		command: Command<unknown, never> | string,
		arg?: unknown
	) => boolean,
	claims: (() => false) as (event: KeyboardEvent) => boolean,
	openMenu: () => false,
	openRows: () => ({ isOpen: false, close() {} }),
	doc: (): Doc => {
		throw new Error('the inert plugin context holds no document');
	},
	selection: () => null,
	select: async () => false,
	view: {
		view: INERT_VIEW,
		dispose: () => {}
	},
	pluginEvents: (): PluginEventReads => ({
		edit: () => {
			throw new Error('the inert plugin context writes nothing');
		},
		selection: () => null,
		doc: () => {
			throw new Error('the inert plugin context holds no document');
		},
		listenForEdits: () => () => {}
	}),
	blockAt: () => null,
	repaint: () => {},
	units: (): readonly InstalledPlugin[] => [],
	pluginNames: (): readonly string[] => [],
	report: (() => {}) as (error: PluginError) => void,
	edit: () => idleDraftRegistry().edit(),
	reading: kitReading()
});

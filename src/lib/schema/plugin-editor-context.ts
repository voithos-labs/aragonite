/**
 * One editor's view for each plugin it runs: the `EditorContext` a `setup` plugin's `onEditor`
 * callbacks get, and the `Editor` a plugin value's `setup` gets. What either adds is disposed
 * when the plugin is turned off or the editor unmounts, and an error either raises is reported
 * once, through the editor's own report.
 */
import type { DocumentView } from '../core/node-views';
import type { EditorEventMap } from '../editor-events';
import { inlineReaderFor } from '../core/inline';
import type { DecorationRegistry } from '../decorations/types';
import type { EditorRects } from '../editor-rects';
import type { InsertMarkdownOptions } from '../editor-props';
import type { InlineMenuRegistry } from '../inline-menu/types';
import type { PresentationMode } from '../presentation-mode';
import type { ActivationClick } from '../activation-click';
import { insertRows } from './insert-catalogue';
import type { Reading } from './reading';
import type { Draft } from './drafts';
import { resolvesIn, type PluginActivation } from './plugin-activation';
import {
	installedPlugin,
	installedPluginNames,
	onEditorCallbacks,
	resolvePluginOptions,
	type EditorContext,
	type EditorEventSubscriptions
} from './plugin-install';
import type { Editor, InstalledPlugin, PluginError } from './plugin-unit';
import type { Command } from './plugin-command';
import type { CaretMenu } from './caret-menu';

export interface EditorPluginContexts {
	/** This editor's context for a plugin it activated; `undefined` for one it did not. The empty
	 *  name returns the editor's base context, the one kinds no plugin owns use, never filtered. */
	get(pluginName: string): EditorContext | undefined;
	/** Runs every turned-on plugin's `onEditor` callbacks and `setup`, once the editor is mounted. */
	attachAll(): void;
	/** `attachAll` for the plugins `use` turned on. */
	attach(pluginNames: readonly string[]): void;
	/** Disposes what a plugin `use` turned off added, and forgets its views. */
	detach(pluginName: string): void;
	/** The editor a plugin value sees, scoped to it, as its `setup` and its drawings get it. */
	editor(pluginName: string): Editor;
	/** The `Editor` a running plugin value's `setup` and commands get: one per plugin, kept while a
	 *  `use` keeps the plugin and dropped when it's turned off. */
	scoped(pluginName: string): Editor | undefined;
	dispose(): void;
}

// Editor ids counted up across the process: `editor-1`, `editor-2`, … Stable for the life of a
// mount, so a plugin can key its per-editor state on `editor.editorId`.
let n = 0;
export const mintEditorId = () => `editor-${++n}`;

export function createEditorPluginContexts(deps: {
	editorId: string;
	getDoc: () => DocumentView;
	events: EditorEventSubscriptions;
	/** The entry's options as the host wrote them, before the merge. */
	optionsFor: (pluginName: string) => unknown;
	decorations: DecorationRegistry;
	rects: EditorRects;
	inlineMenus: InlineMenuRegistry;
	getDocumentGeneration: () => number;
	getPresentationMode: () => PresentationMode;
	getTheme: () => string;
	activationClick: ActivationClick;
	activation: PluginActivation;
	/** The instance's own entry points; the context only delegates. */
	insertMarkdown: (md: string, options?: InsertMarkdownOptions) => Promise<boolean>;
	runCommand: (command: Command<unknown> | string, arg?: unknown) => boolean;
	canRunCommand: (command: Command<unknown> | string, arg?: unknown) => boolean;
	claims: (event: KeyboardEvent) => boolean;
	openMenu: (menu: CaretMenu<unknown>, query?: string) => boolean;
	openRows: Editor['openRows'];
	blockAt: Editor['blockAt'];
	/** Asks `plugin`'s paint again. */
	repaint: (plugin: string, blocks?: Parameters<Editor['repaint']>[0]) => void;
	/** A draft; `plugin` names the plugin it's refused for once that plugin is off. */
	edit: (plugin?: string) => Draft;
	/** How the editor reads its bytes, which every plugin inline read follows. */
	reading: Reading;
	/** The plugin values this editor runs, with what each contributed. */
	units: () => readonly InstalledPlugin[];
	pluginNames: () => readonly string[];
	report: (error: PluginError) => void;
}): EditorPluginContexts {
	const contexts = new Map<string, EditorContext>();
	const editors = new Map<string, Editor>();
	const disposers: { plugin: string; dispose: () => void }[] = [];
	const { report } = deps;

	function optionsFor(pluginName: string): unknown {
		const plugin = installedPlugin(pluginName) ?? {};
		try {
			return resolvePluginOptions(plugin, deps.optionsFor(pluginName));
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : String(cause);
			const error = new Error(
				`plugin '${pluginName}': options rejected, running on its defaults: ${message}`,
				{ cause }
			);
			report({ plugin: pluginName, doing: 'validate', cause: error });
			return resolvePluginOptions(plugin, undefined);
		}
	}

	function get(pluginName: string): EditorContext | undefined {
		if (pluginName !== '' && !resolvesIn(deps.activation, pluginName)) return undefined;
		let ctx = contexts.get(pluginName);
		if (!ctx) {
			ctx = {
				editorId: deps.editorId,
				get document() {
					return deps.getDoc();
				},
				get documentGeneration() {
					return deps.getDocumentGeneration();
				},
				events:
					pluginName === ''
						? deps.events
						: { on: (event, listen) => listenAs(pluginName, event, listen) },
				options: optionsFor(pluginName),
				decorations: deps.decorations,
				rects: deps.rects,
				inlineMenus: deps.inlineMenus,
				get insertCatalogue() {
					return insertRows(deps.activation);
				},
				insertMarkdown: (md, options) => deps.insertMarkdown(md, options),
				runCommand: (commandId, arg) => deps.runCommand(commandId, arg),
				edit: () => deps.edit(pluginName || undefined),
				get computeInlineContent() {
					return inlineReaderFor(deps.reading);
				},
				get presentationMode() {
					return deps.getPresentationMode();
				},
				get theme() {
					return deps.getTheme();
				},
				isActivationClick: (click) => deps.activationClick(click)
			};
			contexts.set(pluginName, ctx);
		}
		return ctx;
	}

	function editorFor(plugin: string): Editor {
		let editor = editors.get(plugin);
		if (!editor) editors.set(plugin, (editor = scopedEditor(plugin)));
		return editor;
	}

	function scopedEditor(plugin: string): Editor {
		return {
			get plugins() {
				return deps.pluginNames();
			},
			get mode() {
				return deps.getPresentationMode();
			},
			get theme() {
				return deps.getTheme();
			},
			get inserts() {
				return insertRows(deps.activation);
			},
			on(event, listen) {
				const disposer = { plugin, dispose: listenAs(plugin, event, listen) };
				disposers.push(disposer);
				return () => disposeOne(disposer);
			},
			run: (command: Command<unknown> | string, arg?: unknown) => deps.runCommand(command, arg),
			can: (command: Command<unknown> | string, arg?: unknown) => deps.canRunCommand(command, arg),
			claims: (event) => deps.claims(event),
			openMenu: (menu, query) => deps.openMenu(menu as CaretMenu<unknown>, query),
			openRows: (action, range, anchor) => deps.openRows(action, range, anchor),
			edit: () => deps.edit(plugin),
			blockAt: (at) => deps.blockAt(at),
			repaint: (blocks) => deps.repaint(plugin, blocks)
		};
	}

	// A throw is reported naming the plugin; an `error` listener's would report back to itself.
	function listenAs<K extends keyof EditorEventMap>(
		plugin: string,
		event: K,
		listen: (payload: EditorEventMap[K]) => void
	): () => void {
		if (event === 'error') return deps.events.on(event, listen);
		return deps.events.on(event, (payload) => {
			try {
				listen(payload);
			} catch (cause) {
				report({ plugin, doing: `on('${event}')`, cause });
			}
		});
	}

	function attach(names: ReadonlySet<string> | null): void {
		for (const plugin of installedPluginNames()) {
			if (!resolvesIn(deps.activation, plugin) || (names && !names.has(plugin))) continue;
			for (const cb of onEditorCallbacks(plugin)) {
				try {
					const dispose = cb(get(plugin)!);
					if (typeof dispose === 'function') disposers.push({ plugin, dispose });
				} catch (cause) {
					report({ plugin, doing: 'setup', cause });
				}
			}
		}
		for (const { name, contribution } of deps.units()) {
			if (names && !names.has(name)) continue;
			try {
				const cleanup = contribution.setup?.(editorFor(name));
				if (typeof cleanup === 'function') disposers.push({ plugin: name, dispose: cleanup });
			} catch (cause) {
				report({ plugin: name, doing: 'setup', cause });
			}
		}
	}

	function disposeOne(disposer: { plugin: string; dispose: () => void }): void {
		const at = disposers.indexOf(disposer);
		if (at < 0) return;
		disposers.splice(at, 1);
		try {
			disposer.dispose();
		} catch (cause) {
			report({ plugin: disposer.plugin, doing: 'dispose', cause });
		}
	}

	return {
		get,
		editor: editorFor,
		scoped: (pluginName) =>
			deps.units().some((unit) => unit.name === pluginName) ? editorFor(pluginName) : undefined,
		attachAll: () => attach(null),
		attach: (pluginNames) => attach(new Set(pluginNames)),
		detach(pluginName) {
			for (const disposer of disposers.filter((d) => d.plugin === pluginName)) disposeOne(disposer);
			contexts.delete(pluginName);
			editors.delete(pluginName);
		},
		dispose() {
			for (const disposer of [...disposers]) disposeOne(disposer);
		}
	};
}

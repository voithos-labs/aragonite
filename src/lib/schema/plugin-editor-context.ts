/**
 * One `EditorContext` per editor and plugin: the object `onEditor` callbacks, global-command
 * handlers and `BlockCommandContext.editor` all receive. `document` is a getter so every read is
 * live (`docs/contributing/rules.md` § The five rules), and `options` is the plugin's defaults
 * merged with this editor's entry.
 */
import type { DocumentView, NodeView } from '../core/node-views';
import type { InlineNode } from '../core/nodes';
import type { DecorationRegistry } from '../decorations/types';
import type { EditorRects } from '../editor-rects';
import type { InsertMarkdownOptions } from '../editor-props';
import type { InlineMenuRegistry } from '../inline-menu/types';
import type { PresentationMode } from '../presentation-mode';
import { insertCatalogue } from './insert-catalogue';
import { resolvesIn, type PluginActivation } from './plugin-activation';
import {
	installedPlugin,
	installedPluginNames,
	onEditorCallbacks,
	resolvePluginOptions,
	type EditorContext,
	type EditorEventSubscriptions
} from './plugin-install';

type ErrorReport = { plugin: string; error: unknown };

export interface EditorPluginContexts {
	/** This editor's context for a plugin it activated; `undefined` for one it did not. The empty
	 *  name returns the editor's base context, the one kinds no plugin owns use, never filtered. */
	get(pluginName: string): EditorContext | undefined;
	/** Also receives any options error reported before it was called. */
	attachAll(onError: (report: ErrorReport) => void): void;
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
	activation: PluginActivation;
	/** The instance's own entry points; the context only delegates. */
	insertMarkdown: (md: string, options?: InsertMarkdownOptions) => Promise<boolean>;
	runCommand: (commandId: string, arg?: unknown) => boolean;
	/** An inline parse in the editor's grammar. */
	computeInlineContent: (node: NodeView) => InlineNode[];
}): EditorPluginContexts {
	const contexts = new Map<string, EditorContext>();
	const disposers: { plugin: string; dispose: () => void }[] = [];
	// A block reads its options while it renders, which is before `attachAll` sets a handler.
	const early: ErrorReport[] = [];
	let report: (r: ErrorReport) => void = (r) => void early.push(r);

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
			report({ plugin: pluginName, error });
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
				events: deps.events,
				options: optionsFor(pluginName),
				decorations: deps.decorations,
				rects: deps.rects,
				inlineMenus: deps.inlineMenus,
				get insertCatalogue() {
					return insertCatalogue(deps.activation);
				},
				insertMarkdown: (md, options) => deps.insertMarkdown(md, options),
				runCommand: (commandId, arg) => deps.runCommand(commandId, arg),
				computeInlineContent: deps.computeInlineContent,
				get presentationMode() {
					return deps.getPresentationMode();
				},
				get theme() {
					return deps.getTheme();
				}
			};
			contexts.set(pluginName, ctx);
		}
		return ctx;
	}

	return {
		get,
		attachAll(onError) {
			report = onError;
			for (const r of early.splice(0)) onError(r);
			for (const plugin of installedPluginNames()) {
				if (!resolvesIn(deps.activation, plugin)) continue;
				for (const cb of onEditorCallbacks(plugin)) {
					try {
						const dispose = cb(get(plugin)!);
						if (typeof dispose === 'function') disposers.push({ plugin, dispose });
					} catch (error) {
						onError({ plugin, error });
					}
				}
			}
		},
		dispose() {
			for (const d of disposers.splice(0)) {
				try {
					d.dispose();
				} catch (error) {
					report({ plugin: d.plugin, error });
				}
			}
		}
	};
}

/**
 * One `EditorContext` per editor and plugin: the object `onEditor` callbacks, global-command
 * handlers and `BlockCommandContext.editor` all receive. `document` is a getter so every read is
 * live (rules.md: getters, not values).
 */
import type { DocumentView } from '../core/node-views';
import type { DecorationRegistry } from '../decorations/types';
import type { EditorRects } from '../editor-rects';
import type { InsertMarkdownOptions } from '../editor-props';
import type { InlineMenuRegistry } from '../inline-menu/types';
import type { PresentationMode } from '../presentation-mode';
import { insertCatalogue } from './insert-catalogue';
import type { PluginActivation } from './plugin-activation';
import {
	installedPluginNames,
	onEditorCallbacks,
	type EditorContext,
	type EditorEventSubscriptions
} from './plugin-install';

export interface EditorPluginContexts {
	/** This editor's context for a plugin it activated; `undefined` for one it did not. The empty
	 *  name returns the editor's base context, the one kinds no plugin owns use, never filtered. */
	get(pluginName: string): EditorContext | undefined;
	attachAll(onError: (report: { plugin: string; error: unknown }) => void): void;
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
	optionsFor: (pluginName: string) => unknown;
	decorations: DecorationRegistry;
	rects: EditorRects;
	inlineMenus: InlineMenuRegistry;
	getDocumentGeneration: () => number;
	getPresentationMode: () => PresentationMode;
	getTheme: () => string;
	activation: PluginActivation;
	/** The instance's own entry points; the context only delegates. */
	insertMarkdown: (md: string, options?: InsertMarkdownOptions) => boolean;
	runCommand: (commandId: string, arg?: unknown) => boolean;
}): EditorPluginContexts {
	const contexts = new Map<string, EditorContext>();
	const disposers: { plugin: string; dispose: () => void }[] = [];
	let onDisposeError: (report: { plugin: string; error: unknown }) => void = () => {};

	function get(pluginName: string): EditorContext | undefined {
		if (pluginName !== '' && !deps.activation.isActive(pluginName)) return undefined;
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
				options: deps.optionsFor(pluginName),
				decorations: deps.decorations,
				rects: deps.rects,
				inlineMenus: deps.inlineMenus,
				get insertCatalogue() {
					return insertCatalogue(deps.activation.isActive);
				},
				insertMarkdown: (md, options) => deps.insertMarkdown(md, options),
				runCommand: (commandId, arg) => deps.runCommand(commandId, arg),
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
			onDisposeError = onError;
			for (const plugin of installedPluginNames()) {
				if (!deps.activation.isActive(plugin)) continue;
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
					onDisposeError({ plugin: d.plugin, error });
				}
			}
		}
	};
}

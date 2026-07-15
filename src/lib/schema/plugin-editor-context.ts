/**
 * Per-(instance, plugin) EditorContext: the one object onEditor callbacks,
 * global-command handlers, and BlockCommandContext.editor all receive — the
 * "one context object, not two" freeze litmus, satisfied structurally.
 * `document` is a getter so every read is live (culture: getters, not values).
 */
import type { DocumentView } from '../core/node-views';
import type { DecorationRegistry } from '../decorations/types';
import type { EditorRects } from '../editor-rects';
import {
	installedPluginNames,
	onEditorCallbacks,
	type EditorContext,
	type EditorEventSubscriptions
} from './plugin-install';

export interface EditorPluginContexts {
	get(pluginName: string): EditorContext;
	attachAll(onError: (report: { plugin: string; error: unknown }) => void): void;
	dispose(): void;
}

// Process-monotonic instance id: `editor-1`, `editor-2`, … Stable per mount, so a
// plugin can key per-instance state on `editor.editorId`.
let n = 0;
export const mintEditorId = () => `editor-${++n}`;

export function createEditorPluginContexts(deps: {
	editorId: string;
	getDoc: () => DocumentView;
	events: EditorEventSubscriptions;
	optionsFor: (pluginName: string) => unknown;
	decorations: DecorationRegistry;
	rects: EditorRects;
}): EditorPluginContexts {
	const contexts = new Map<string, EditorContext>();
	const disposers: { plugin: string; dispose: () => void }[] = [];
	let onDisposeError: (report: { plugin: string; error: unknown }) => void = () => {};

	function get(pluginName: string): EditorContext {
		let ctx = contexts.get(pluginName);
		if (!ctx) {
			ctx = {
				editorId: deps.editorId,
				get document() {
					return deps.getDoc();
				},
				events: deps.events,
				options: deps.optionsFor(pluginName),
				decorations: deps.decorations,
				rects: deps.rects
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
				for (const cb of onEditorCallbacks(plugin)) {
					try {
						const dispose = cb(get(plugin));
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

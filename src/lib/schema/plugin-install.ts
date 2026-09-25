import { devWarn } from '../dev-warn';
import { isValidPluginName } from './plugin-name';
import { enrollTestReset } from './registry-reset';
// Type-only: `editor-events` already imports this module at runtime, so importing a value back
// would close a cycle from `schema/` to the root.
import type { DocumentView, NodeView } from '../core/node-views';
import type { InlineNode } from '../core/nodes';
import type { EditorEvents } from '../editor-events';
import type { InsertMarkdownOptions } from '../editor-props';
import type { DecorationRegistry } from '../decorations/types';
import type { EditorRects } from '../editor-rects';
import type { InlineMenuRegistry } from '../inline-menu/types';
import type { PresentationMode } from '../presentation-mode';
import type { InsertEntry } from './insert-catalogue';

export interface EditorPlugin<Options = unknown> {
	readonly name: string;
	readonly version?: string;
	setup(ctx: PluginSetupContext<Options>): void;
}

// ── Setup-time context + per-editor subscription ─────────────────────────────
// `setup` receives a `PluginSetupContext` for this install; `onEditor` registers a callback that
// runs once per mounted `<Editor>`. Option types flow through the generic, but `setup` stays
// method syntax (bivariant parameters) so a plugin with typed options is still assignable.

export interface PluginSetupContext<Options = unknown> {
	onEditor(cb: OnEditorCallback<Options>): void;
}
export type OnEditorCallback<Options = unknown> = (
	editor: EditorContext<Options>
) => void | (() => void);

/** Subscribe-only view of the editor's events. `EditorContext` must not expose the full
 *  `EditorEvents`: that would freeze a plugin-visible `emit` into the 1.0 API. */
export type EditorEventSubscriptions = Pick<EditorEvents, 'on'>;
export interface EditorContext<Options = unknown> {
	readonly editorId: string;
	readonly document: DocumentView; // getter-backed, live; mutation goes through commits
	/** A getter, so always live, but not reactive: how many times a `source` write has replaced
	 *  the document, 0 at mount. Subscribe to the `sourceSwap` event to hear a change. */
	readonly documentGeneration: number;
	readonly events: EditorEventSubscriptions;
	readonly options: Options;
	readonly decorations: DecorationRegistry;
	readonly rects: EditorRects;
	/** Menus opened under the caret by a typed trigger: tag autocomplete, a document picker. */
	readonly inlineMenus: InlineMenuRegistry;
	/** A getter, so always live: the blocks the insert menus offer in this editor, plugin blocks
	 *  included; the same list as `EditorInstance.getInsertCatalogue()`. */
	readonly insertCatalogue: readonly InsertEntry[];
	/** `EditorInstance.insertMarkdown` for this editor: false, nothing written, with no caret, in
	 *  reading mode or at a gap caret. Await it in `onCommit` to keep one undo entry for the pick. */
	readonly insertMarkdown: (md: string, options?: InsertMarkdownOptions) => Promise<boolean>;
	/** `EditorInstance.runCommand` for this editor: false, and nothing written, on an unknown id,
	 *  in reading mode, or with nothing focused for a block command. */
	readonly runCommand: (commandId: string, arg?: unknown) => boolean;
	/** Inline-parse a prose leaf in this editor's syntax, so a plugin its `plugins` prop left out
	 *  reads as text, as the editor draws it. Uncached, safe to pass on its own; reference links
	 *  come back unresolved. */
	readonly computeInlineContent: (node: NodeView) => InlineNode[];
	/** A getter, so always live: the mode in effect. The `presentationModeChange` event signals a change. */
	readonly presentationMode: PresentationMode;
	/** A getter, so always live: the theme name written to `data-editor-theme`. The `themeChange`
	 *  event signals a change. Only a plugin that draws its own colors needs it. */
	readonly theme: string;
}

// ── Process-global install state ─────────────────────────────────────────────
// A plugin is code: its setup writes into register-once registries, so it runs at most once per
// process. `failed` keeps the name of a plugin whose setup threw together with the original error,
// since a half-finished setup cannot re-run and a later attempt must say to reload without losing
// the cause.

const installed = new Map<string, EditorPlugin>();
const failed = new Map<string, unknown>();
const onEditorSubs = new Map<string, OnEditorCallback[]>();

let installing: string | null = null;
// Bumped whenever the installed set changes, so a cache filtered by installation can tell it is stale.
let generation = 0;

// ── Public API ───────────────────────────────────────────────────────────────

export function definePlugin<Options = unknown>(
	plugin: EditorPlugin<Options>
): EditorPlugin<Options> {
	if (typeof plugin.setup !== 'function') {
		throw new Error(`definePlugin: '${plugin.name}' setup must be a function`);
	}
	if (!isValidPluginName(plugin.name)) {
		throw new Error(
			`definePlugin: invalid plugin name "${plugin.name}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
	return plugin;
}

export function installPlugins(plugins: readonly EditorPlugin[]): void {
	for (const plugin of plugins) {
		const alreadyInstalled = installed.get(plugin.name);
		if (alreadyInstalled) {
			if (alreadyInstalled !== plugin) {
				devWarn(
					'plugin-install',
					`plugin '${pluginLabel(plugin)}' already installed; this definition (including any options) is ignored; definitions are process-global`
				);
			}
			continue;
		}
		if (failed.has(plugin.name)) {
			throw new Error(
				`plugin '${pluginLabel(plugin)}' failed during a previous install; reload the page (or restart the dev server); register-once registries cannot re-run a partial setup`,
				{ cause: failed.get(plugin.name) }
			);
		}
		installOne(plugin);
	}
}

/** A `plugins` prop entry: a plugin on its own, or a plugin with options for this editor. */
export type EditorPluginEntry = EditorPlugin | { plugin: EditorPlugin; options?: unknown };

/**
 * Split a `plugins` prop into the install list and a name-to-options map. The options belong to
 * one editor even though a plugin installs once per process. A plugin listed twice keeps its first
 * entry, the same first-wins rule `installPlugins` uses, so the options map cannot disagree.
 */
export function normalizePluginEntries(entries: readonly EditorPluginEntry[]): {
	plugins: EditorPlugin[];
	optionsByName: Map<string, unknown>;
} {
	const plugins: EditorPlugin[] = [];
	const optionsByName = new Map<string, unknown>();
	const seen = new Set<string>();
	for (const entry of entries) {
		const plugin = 'plugin' in entry ? entry.plugin : entry;
		if (seen.has(plugin.name)) {
			devWarn(
				'plugin-install',
				`plugin '${plugin.name}' listed twice in one plugins prop; the first entry (and its options) wins`
			);
			continue;
		}
		seen.add(plugin.name);
		plugins.push(plugin);
		if ('plugin' in entry && 'options' in entry) optionsByName.set(plugin.name, entry.options);
	}
	return { plugins, optionsByName };
}

export function isPluginInstalled(name: string): boolean {
	return installed.has(name);
}

export function currentInstallingPlugin(): string | null {
	return installing;
}

/** Runs shared registrations a plugin's setup triggers as core ones, owned by no plugin, so every
 *  editor resolves them whichever plugin reached them first. */
export function registerAsCore(register: () => void): void {
	const outer = installing;
	installing = null;
	try {
		register();
	} finally {
		installing = outer;
	}
}

export function pluginInstallGeneration(): number {
	return generation;
}

/** onEditor callbacks a plugin registered during setup, in registration order. */
export function onEditorCallbacks(pluginName: string): readonly OnEditorCallback[] {
	return onEditorSubs.get(pluginName) ?? [];
}

/** Installed plugin names, in install order. */
export function installedPluginNames(): string[] {
	return [...installed.keys()];
}

export function __resetInstalledPluginsForTests(): void {
	installed.clear();
	failed.clear();
	onEditorSubs.clear();
	generation++;
}
enrollTestReset(__resetInstalledPluginsForTests);

// ── Internal ─────────────────────────────────────────────────────────────────

function installOne(plugin: EditorPlugin): void {
	installing = plugin.name;
	const { ctx, close } = makeSetupContext(plugin.name);
	try {
		plugin.setup(ctx);
	} catch (original) {
		// A setup that threw after calling onEditor must leave no orphaned subscriptions: the
		// plugin never installs, so its callbacks must never run.
		onEditorSubs.delete(plugin.name);
		failed.set(plugin.name, original);
		const message = original instanceof Error ? original.message : String(original);
		throw new Error(`plugin '${pluginLabel(plugin)}': ${message}`, { cause: original });
	} finally {
		close();
		installing = null;
		generation++;
	}
	installed.set(plugin.name, plugin);
}

// `onEditor` works during setup only: the context closes the moment setup returns, so a context
// kept past that throws instead of quietly registering into an install that is already over.
function makeSetupContext(pluginName: string): { ctx: PluginSetupContext; close: () => void } {
	let open = true;
	const ctx: PluginSetupContext = {
		onEditor(cb) {
			if (!open) {
				throw new Error(
					`onEditor: '${pluginName}' called onEditor after setup returned; subscriptions are synchronous-only (the same boundary as kind attribution)`
				);
			}
			let list = onEditorSubs.get(pluginName);
			if (!list) onEditorSubs.set(pluginName, (list = []));
			list.push(cb);
		}
	};
	return { ctx, close: () => (open = false) };
}

// `name@version` when the plugin carries a version, so a clash between two versions is
// unambiguous in the warning and in the two failure messages.
function pluginLabel(plugin: EditorPlugin): string {
	return plugin.version ? `${plugin.name}@${plugin.version}` : plugin.name;
}

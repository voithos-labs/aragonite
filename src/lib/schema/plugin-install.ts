import { devWarn } from '../dev-warn';
import { isValidPluginName } from './plugin-name';
// Type-only: the runtime edge already runs editor-events → plugin-install
// (pluginKindOwner). A value import back would close a schema→root cycle, so the
// EditorContext view of the event surface stays a compile-time reference only.
import type { Document } from '../core/nodes';
import type { EditorEvents } from '../editor-events';

export interface EditorPlugin<Options = unknown> {
	readonly name: string;
	readonly version?: string;
	setup(ctx: PluginSetupContext<Options>): void;
}

// ── Setup-time context + per-editor subscription ─────────────────────────────
// `setup` receives a PluginSetupContext scoped to the install; `onEditor`
// registers a callback fired once per <Editor> instance (Task 2 builds the
// EditorContext it receives). Option typing flows by generic — a plugin author
// writing `definePlugin<DocStatsOptions>` reads `editor.options: DocStatsOptions`
// with no cast — but `setup` stays method syntax (bivariant params) so a typed
// plugin remains assignable at the heterogeneous install boundary.

export interface PluginSetupContext<Options = unknown> {
	onEditor(cb: OnEditorCallback<Options>): void;
}
export type OnEditorCallback<Options = unknown> = (
	editor: EditorContext<Options>
) => void | (() => void);

/** Subscribe-only view of the events surface. EditorContext must NOT expose the
 *  full EditorEvents — that would freeze plugin-visible `emit` at 1.0. */
export type EditorEventSubscriptions = Pick<EditorEvents, 'on'>;
export interface EditorContext<Options = unknown> {
	readonly editorId: string;
	readonly document: Document; // getter-backed, live
	readonly events: EditorEventSubscriptions;
	readonly options: Options;
}

// ── Process-global install state ─────────────────────────────────────────────
// A plugin is code: its setup writes into register-once registries, so it can run
// at most once per process. `installed` holds only successes; `failed` remembers a
// name whose setup threw (a partial setup can't be re-run) alongside its original
// error, so a later attempt can advise a reload without swallowing the cause.

const installed = new Map<string, EditorPlugin>();
const failed = new Map<string, unknown>();
const kindOwners = new Map<string, string>();
const onEditorSubs = new Map<string, OnEditorCallback[]>();

let installing: string | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function definePlugin<Options = unknown>(
	plugin: EditorPlugin<Options>
): EditorPlugin<Options> {
	if (typeof plugin.setup !== 'function') {
		throw new Error(`definePlugin: '${plugin.name}' setup must be a function`);
	}
	if (!isValidPluginName(plugin.name)) {
		throw new Error(
			`definePlugin: invalid plugin name "${plugin.name}" — lowercase first letter, then letters/digits/hyphens`
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
					`plugin '${pluginLabel(plugin)}' already installed; this definition (including any options) is ignored — definitions are process-global`
				);
			}
			continue;
		}
		if (failed.has(plugin.name)) {
			throw new Error(
				`plugin '${pluginLabel(plugin)}' failed during a previous install; reload the page (or restart the dev server) — register-once registries cannot re-run a partial setup`,
				{ cause: failed.get(plugin.name) }
			);
		}
		installOne(plugin);
	}
}

export function isPluginInstalled(name: string): boolean {
	return installed.has(name);
}

export function currentInstallingPlugin(): string | null {
	return installing;
}

export function recordPluginKindOwner(kind: string, plugin: string): void {
	kindOwners.set(kind, plugin);
}

export function pluginKindOwner(kind: string): string | null {
	return kindOwners.get(kind) ?? null;
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
	kindOwners.clear();
	onEditorSubs.clear();
}

// ── Internal ─────────────────────────────────────────────────────────────────

function installOne(plugin: EditorPlugin): void {
	installing = plugin.name;
	const { ctx, close } = makeSetupContext(plugin.name);
	try {
		plugin.setup(ctx);
	} catch (original) {
		// A setup that threw after calling onEditor must leave no orphaned
		// subscriptions — the plugin never installs, so its callbacks never run.
		onEditorSubs.delete(plugin.name);
		failed.set(plugin.name, original);
		const message = original instanceof Error ? original.message : String(original);
		throw new Error(`plugin '${pluginLabel(plugin)}': ${message}`, { cause: original });
	} finally {
		close();
		installing = null;
	}
	installed.set(plugin.name, plugin);
}

// onEditor is synchronous-only: the closer fires the moment setup returns, so a
// context leaked past setup throws instead of silently registering into a wiped
// install — the same boundary as kind attribution.
function makeSetupContext(pluginName: string): { ctx: PluginSetupContext; close: () => void } {
	let open = true;
	const ctx: PluginSetupContext = {
		onEditor(cb) {
			if (!open) {
				throw new Error(
					`onEditor: '${pluginName}' called onEditor after setup returned — subscriptions are synchronous-only (the same boundary as kind attribution)`
				);
			}
			let list = onEditorSubs.get(pluginName);
			if (!list) onEditorSubs.set(pluginName, (list = []));
			list.push(cb);
		}
	};
	return { ctx, close: () => (open = false) };
}

// Install diagnostics identify a plugin as `name@version` when it carries a
// version, bare `name` otherwise — so a two-version collision (same name, two
// definitions) reads unambiguously in the warn and the two failure throws.
function pluginLabel(plugin: EditorPlugin): string {
	return plugin.version ? `${plugin.name}@${plugin.version}` : plugin.name;
}

import { devWarn } from '../dev-warn';
import { isValidPluginName } from './plugin-name';

export interface EditorPlugin {
	readonly name: string;
	readonly version?: string;
	setup(): void;
}

// ── Process-global install state ─────────────────────────────────────────────
// A plugin is code: its setup writes into register-once registries, so it can run
// at most once per process. `installed` holds only successes; `failed` remembers a
// name whose setup threw (a partial setup can't be re-run) alongside its original
// error, so a later attempt can advise a reload without swallowing the cause.

const installed = new Map<string, EditorPlugin>();
const failed = new Map<string, unknown>();
const kindOwners = new Map<string, string>();

let installing: string | null = null;

// ── Public API ───────────────────────────────────────────────────────────────

export function definePlugin(plugin: EditorPlugin): EditorPlugin {
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

export function __resetInstalledPluginsForTests(): void {
	installed.clear();
	failed.clear();
	kindOwners.clear();
}

// ── Internal ─────────────────────────────────────────────────────────────────

function installOne(plugin: EditorPlugin): void {
	installing = plugin.name;
	try {
		plugin.setup();
	} catch (original) {
		failed.set(plugin.name, original);
		const message = original instanceof Error ? original.message : String(original);
		throw new Error(`plugin '${pluginLabel(plugin)}': ${message}`, { cause: original });
	} finally {
		installing = null;
	}
	installed.set(plugin.name, plugin);
}

// Install diagnostics identify a plugin as `name@version` when it carries a
// version, bare `name` otherwise — so a two-version collision (same name, two
// definitions) reads unambiguously in the warn and the two failure throws.
function pluginLabel(plugin: EditorPlugin): string {
	return plugin.version ? `${plugin.name}@${plugin.version}` : plugin.name;
}

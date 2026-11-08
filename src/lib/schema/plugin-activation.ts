/**
 * Which plugins one editor turned on, and the one check every plugin registration is read
 * through. An editor turns on exactly what its `plugins` prop lists; one mounted without that
 * prop turns on every plugin installed in the process
 * (`docs/design/plugin-contract.md` § Per-instance enablement).
 */
import { installedPluginNames, isPluginInstalled } from './plugin-install';
import type { EditorContributions } from './editor-contributions';

export interface PluginActivation {
	isActive(pluginName: string): boolean;
	/** Counts the changes to an activation that changes in place, so a list built from it rebuilds. */
	readonly generation?: number;
	/** What the editor's plugin values contribute; absent outside an editor, where none run. */
	readonly contributions?: EditorContributions;
}

/** One editor's plugins, by name, which `use` changes in place; `null` turns on every installed one. */
export interface EditorActivation extends PluginActivation {
	readonly generation: number;
	readonly names: readonly string[];
	set(names: readonly string[] | null): void;
}

/** The default when no `plugins` prop is given. A plugin whose setup threw is never installed, so
 *  it's never active. */
export const everyInstalledPlugin: PluginActivation = {
	isActive: (name) => isPluginInstalled(name)
};

export function activationFor(pluginNames: readonly string[]): PluginActivation {
	const active = new Set(pluginNames);
	return { isActive: (name) => active.has(name) && isPluginInstalled(name) };
}

export function createEditorActivation(
	names: readonly string[] | null,
	contributions?: EditorContributions
): EditorActivation {
	let active = names && new Set(names);
	let generation = 0;
	return {
		contributions,
		isActive: (name) => (active ? active.has(name) : isPluginInstalled(name)),
		get generation() {
			return generation;
		},
		get names() {
			return active ? [...active] : installedPluginNames();
		},
		set(next) {
			active = next && new Set(next);
			generation++;
		}
	};
}

/** An entry no plugin owns always resolves; a plugin's only where the editor turned it on. */
export function resolvesIn(activation: PluginActivation, owner: string | null): boolean {
	return owner === null || activation.isActive(owner);
}

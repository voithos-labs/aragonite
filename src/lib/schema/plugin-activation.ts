/**
 * Which plugins one editor turned on, and the one check every plugin registration is read
 * through. An editor turns on exactly what its `plugins` prop lists; one mounted without that
 * prop turns on every plugin installed in the process
 * (`docs/design/plugin-contract.md` § Per-instance enablement).
 */
import { isPluginInstalled } from './plugin-install';

export interface PluginActivation {
	isActive(pluginName: string): boolean;
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

/** An entry no plugin owns always resolves; a plugin's only where the editor turned it on. */
export function resolvesIn(activation: PluginActivation, owner: string | null): boolean {
	return owner === null || activation.isActive(owner);
}

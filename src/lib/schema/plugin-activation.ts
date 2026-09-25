/**
 * Which plugins one editor activates, and the one check every plugin registration is read
 * through. Definitions are process-wide; an editor activates exactly the plugins its `plugins`
 * prop lists, and one mounted without that prop activates everything installed in the process
 * (docs/design/plugin-contract.md § Per-instance enablement).
 */
import { isPluginInstalled } from './plugin-install';

export interface PluginActivation {
	isActive(pluginName: string): boolean;
}

/** The default when no `plugins` prop is given; `resolvesIn` still drops a plugin whose setup threw. */
export const everyInstalledPlugin: PluginActivation = { isActive: () => true };

export function activationFor(pluginNames: readonly string[]): PluginActivation {
	const active = new Set(pluginNames);
	return { isActive: (name) => active.has(name) };
}

/**
 * Whether an entry registered by `owner` resolves under `activation`. An entry no plugin owns
 * always does; a plugin's entry only once its setup finished without throwing and the editor
 * activated it, so a half-installed plugin resolves nowhere.
 */
export function resolvesIn(activation: PluginActivation, owner: string | null): boolean {
	return owner === null || (isPluginInstalled(owner) && activation.isActive(owner));
}

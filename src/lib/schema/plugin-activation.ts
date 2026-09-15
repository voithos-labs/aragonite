/**
 * Which plugins one editor activates. Definitions are process-wide and the first one wins; this
 * is the per-editor half: an editor activates exactly the plugins its `plugins` prop lists, and an
 * editor mounted without that prop activates everything installed in the process
 * (docs/design/plugin-contract.md § Per-instance enablement).
 */
import type { AnyBlockKind } from '../core/nodes';
import { pluginKindOwner } from './plugin-install';
import type { KindEnablement } from './registry-view';

export interface PluginActivation {
	isActive(pluginName: string): boolean;
}

/** The default when no `plugins` prop is given: everything installed in the process is active. */
export const everyInstalledPlugin: PluginActivation = { isActive: () => true };

export function activationFor(pluginNames: readonly string[]): PluginActivation {
	const active = new Set(pluginNames);
	return { isActive: (name) => active.has(name) };
}

/**
 * A kind whose plugin this editor did not activate resolves no component and drops its opener. A
 * kind no plugin owns is never filtered, which covers the built-ins and any kind registered
 * outside a plugin install.
 */
export function kindEnablementFor(activation: PluginActivation): KindEnablement {
	return (kind: AnyBlockKind) => {
		const owner = pluginKindOwner(kind);
		return owner === null || activation.isActive(owner);
	};
}

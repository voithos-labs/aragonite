/**
 * Which plugins one editor instance activates. Definitions are process-global and first-wins;
 * this is the per-instance half: an editor activates exactly the plugins its `plugins` prop
 * listed, and an editor mounted without the prop activates everything installed in the process
 * (docs/design/plugin-contract.md § Per-instance enablement).
 */
import type { AnyBlockKind } from '../core/nodes';
import { pluginKindOwner } from './plugin-install';
import type { KindEnablement } from './registry-view';

export interface PluginActivation {
	isActive(pluginName: string): boolean;
}

/** The prop-less default: everything installed in the process is active. */
export const everyInstalledPlugin: PluginActivation = { isActive: () => true };

export function activationFor(pluginNames: readonly string[]): PluginActivation {
	const active = new Set(pluginNames);
	return { isActive: (name) => active.has(name) };
}

/**
 * A kind whose owning plugin this instance did not activate resolves no component and drops
 * its opener. A kind no plugin owns is never gated, which covers the built-ins and any kind
 * registered outside an install.
 */
export function kindEnablementFor(activation: PluginActivation): KindEnablement {
	return (kind: AnyBlockKind) => {
		const owner = pluginKindOwner(kind);
		return owner === null || activation.isActive(owner);
	};
}

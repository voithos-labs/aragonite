/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockComponent, BlockComponentProps } from '../block-component';

export interface BlockComponentEntry {
	/**
	 * Declaring `BlockComponent` as the component's Exports lets
	 * `bind:this={ref: BlockComponent}` in BlockHost type-check even though
	 * the concrete component is picked from the registry at runtime. Every
	 * registered component `satisfies BlockComponent`, so the invariant
	 * holds — this just surfaces it to Svelte's dynamic-component typing.
	 */
	component: Component<Record<string, unknown>, BlockComponent>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

/**
 * Typed constructor for a component-registry entry. The `Component<P, BlockComponent>`
 * parameter enforces the two invariants that matter at the call site — the
 * component's exported surface is `BlockComponent`, and its props are a subset of
 * the `BlockComponentProps` BlockHost passes (plus any registry `extraProps`). The
 * single internal cast widens props to the registry's `Record<string, unknown>`;
 * props are contravariant, so a component with specific props can't be assigned
 * directly, but BlockHost always supplies the correct props at runtime.
 */
export function defineBlockComponent<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(
	component: Component<P, BlockComponent>,
	extraProps?: (node: NodeView) => Record<string, unknown>
): BlockComponentEntry {
	return { component: component as BlockComponentEntry['component'], extraProps };
}

const registry = new Map<AnyBlockKind, BlockComponentEntry>();

export function registerBlockComponent(kind: AnyBlockKind, entry: BlockComponentEntry): void {
	if (registry.has(kind)) {
		throw new Error(
			`registerBlockComponent: "${kind}" is already registered. Components are register-once.`
		);
	}
	registry.set(kind, entry);
}

export function getBlockComponent(kind: AnyBlockKind): BlockComponentEntry | undefined {
	return registry.get(kind);
}

/**
 * Probe by name whether a component is registered. `registerBlockComponent`
 * throws on duplicate, so a plugin registering idempotently (HMR / re-import)
 * guards on this. Accepts a plain name so callers needn't pre-brand the kind.
 */
export function isBlockComponentRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
}

/** Test-only. Removes every non-built-in component entry; built-ins survive. */
export function __removePluginComponentsForTests(): void {
	for (const kind of registry.keys()) {
		if (!isBuiltinBlockKind(kind)) registry.delete(kind);
	}
}

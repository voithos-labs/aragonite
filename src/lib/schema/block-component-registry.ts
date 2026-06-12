/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import type { AnyBlockKind, CstNode } from '../core/nodes';
import type { BlockComponent } from '../block-component';

export interface BlockComponentEntry {
	/**
	 * Declaring `BlockComponent` as the component's Exports lets
	 * `bind:this={ref: BlockComponent}` in BlockHost type-check even though
	 * the concrete component is picked from the registry at runtime. Every
	 * registered component `satisfies BlockComponent`, so the invariant
	 * holds — this just surfaces it to Svelte's dynamic-component typing.
	 */
	component: Component<Record<string, unknown>, BlockComponent>;
	extraProps?: (node: CstNode) => Record<string, unknown>;
}

/**
 * Typed constructor for a component-registry entry. The `Component<P, BlockComponent>`
 * parameter enforces the one invariant that matters — the component's exported
 * surface is `BlockComponent` — at the call site. The single internal cast widens
 * props to the registry's `Record<string, unknown>`; props are contravariant, so
 * a component with specific props can't be assigned directly, but BlockHost always
 * supplies the correct props at runtime.
 */
export function defineBlockComponent<P extends Record<string, unknown>>(
	component: Component<P, BlockComponent>,
	extraProps?: (node: CstNode) => Record<string, unknown>
): BlockComponentEntry {
	return { component: component as BlockComponentEntry['component'], extraProps };
}

const registry = new Map<AnyBlockKind, BlockComponentEntry>();

export function registerBlockComponent(kind: AnyBlockKind, entry: BlockComponentEntry): void {
	registry.set(kind, entry);
}

export function getBlockComponent(kind: AnyBlockKind): BlockComponentEntry | undefined {
	return registry.get(kind);
}

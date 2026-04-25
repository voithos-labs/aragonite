/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import type { BlockKind, CstNode } from '../core/nodes';
import type { BlockComponent } from '../contracts';

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

const registry = new Map<BlockKind, BlockComponentEntry>();

export function registerBlockComponent(kind: BlockKind, entry: BlockComponentEntry): void {
	registry.set(kind, entry);
}

export function getBlockComponent(kind: BlockKind): BlockComponentEntry | undefined {
	return registry.get(kind);
}

/**
 * Runtime registry mapping `BlockKind` to the Svelte component that renders
 * it. BlockHost looks up by kind instead of branching on a hardcoded
 * `{#if}` chain, so plugin authors at v1.2 register new kinds by supplying
 * a descriptor plus a component registration here.
 *
 * `extraProps` returns any per-node props the component needs beyond the
 * standard `{ node, index, myPath, ambientPrefix, ref }` set (e.g.
 * TextEditableBlock's `blockClass`).
 */

import type { Component } from 'svelte';
import type { BlockKind, CstNode } from './core/nodes';

export interface BlockComponentEntry {
	component: Component<Record<string, unknown>>;
	extraProps?: (node: CstNode) => Record<string, unknown>;
}

const registry = new Map<BlockKind, BlockComponentEntry>();

export function registerBlockComponent(kind: BlockKind, entry: BlockComponentEntry): void {
	registry.set(kind, entry);
}

export function getBlockComponent(kind: BlockKind): BlockComponentEntry | undefined {
	return registry.get(kind);
}

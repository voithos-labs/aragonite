/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockComponentExports, BlockComponentProps } from '../block-component';
import { deletePluginEntries, registerOnce } from './register-once';

export interface BlockComponentEntry {
	/**
	 * Declaring `BlockComponentExports` as the Exports lets BlockHost's `bind:this` type-check
	 * against a runtime-picked component, and pins the two shapes a block may publish: the
	 * surface itself (a leaf) or a container's single `containerApi`.
	 */
	component: Component<Record<string, unknown>, BlockComponentExports>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

/**
 * Typed constructor for a registry entry: the component publishes one of the two sanctioned
 * surface shapes, and its props are a subset of what BlockHost passes. A container that forgot
 * its `containerApi` fails here rather than mounting as a block nothing can focus. The internal
 * cast widens contravariant props to the registry's `Record<string, unknown>`.
 */
export function defineBlockComponent<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(
	component: Component<P, BlockComponentExports>,
	extraProps?: (node: NodeView) => Record<string, unknown>
): BlockComponentEntry {
	return { component: component as BlockComponentEntry['component'], extraProps };
}

const registry = new Map<AnyBlockKind, BlockComponentEntry>();

export function registerBlockComponent(kind: AnyBlockKind, entry: BlockComponentEntry): void {
	registerOnce(
		registry.has(kind),
		() => registry.set(kind, entry),
		`registerBlockComponent: "${kind}" is already registered. Components are register-once.`
	);
}

export function getBlockComponent(kind: AnyBlockKind): BlockComponentEntry | undefined {
	return registry.get(kind);
}

/**
 * Probe whether a component is registered — `registerBlockComponent` throws on duplicate, so a
 * plugin registering idempotently (HMR / re-import) guards on this. Takes a plain name.
 */
export function isBlockComponentRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
}

/** Test-only. Removes every non-built-in component entry; built-ins survive. */
export function __removePluginComponentsForTests(): void {
	deletePluginEntries(registry, isBuiltinBlockKind);
}

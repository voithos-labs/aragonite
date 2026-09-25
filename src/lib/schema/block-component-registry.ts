/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockComponentExports, BlockComponentProps } from '../block-component';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';

export interface BlockComponentEntry {
	/**
	 * Declaring `BlockComponentExports` as the exports lets BlockHost's `bind:this` type-check
	 * against a component picked at runtime, and fixes the two shapes a block may expose: a leaf's
	 * own editable element, or a container's single `containerApi`.
	 */
	component: Component<Record<string, unknown>, BlockComponentExports>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

/**
 * Typed constructor for a registry entry: the component must expose one of the two allowed
 * shapes, and its props must be a subset of what BlockHost passes. A container that forgot its
 * `containerApi` fails here rather than mounting as a block nothing can focus. The cast widens
 * the component's props to the registry's `Record<string, unknown>`.
 */
export function defineBlockComponent<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(
	component: Component<P, BlockComponentExports>,
	extraProps?: (node: NodeView) => Record<string, unknown>
): BlockComponentEntry {
	return { component: component as BlockComponentEntry['component'], extraProps };
}

const registry = createPluginRegistry<AnyBlockKind, BlockComponentEntry>({
	label: 'registerBlockComponent',
	isBuiltin: isBuiltinBlockKind
});

export function registerBlockComponent(kind: AnyBlockKind, entry: BlockComponentEntry): void {
	registry.register(
		kind,
		entry,
		`registerBlockComponent: "${kind}" is already registered. Components are register-once.`
	);
}

/** The kind's component where `activation` resolves the plugin that registered it. */
export function getBlockComponent(
	kind: AnyBlockKind,
	activation: PluginActivation
): BlockComponentEntry | undefined {
	return registry.get(kind, activation);
}

/**
 * Is a component registered? `registerBlockComponent` throws on a duplicate, so a plugin that
 * may register twice (hot reload, re-import) checks this first. Takes a plain name.
 */
export function isBlockComponentRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
}

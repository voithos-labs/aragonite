/**
 * Runtime `BlockKind → component` map. BlockHost looks up by kind; plugin
 * kinds register a descriptor plus a component entry.
 */

import type { Component } from 'svelte';
import { isBuiltinBlockKind, type AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { BlockComponentExports, BlockComponentProps } from '../block-component';
import type { PluginActivation } from './plugin-activation';
import {
	installedPlugin,
	pluginEditorFor,
	resolvePluginOptions,
	type EditorContext
} from './plugin-install';
import { createBlockKindRegistry } from './plugin-registry';

export interface BlockComponentEntry {
	/** Typed with `BlockComponentExports` so BlockHost's `bind:this` type-checks a component
	 *  picked at runtime. */
	component: Component<Record<string, unknown>, BlockComponentExports>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

/**
 * Typed constructor for a registry entry, so a component publishing no surface, or props BlockHost
 * never passes, fail to compile rather than mount as a block nothing can focus.
 */
export function defineBlockComponent<
	P extends Partial<BlockComponentProps> & Record<string, unknown>
>(
	component: Component<P, BlockComponentExports>,
	extraProps?: (node: NodeView) => Record<string, unknown>
): BlockComponentEntry {
	return { component: component as BlockComponentEntry['component'], extraProps };
}

const registry = createBlockKindRegistry<BlockComponentEntry>({
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

/** The kind's component where `activation` resolves the plugin that owns the kind. */
export function getBlockComponent(
	kind: AnyBlockKind,
	activation: PluginActivation
): BlockComponentEntry | undefined {
	return registry.get(kind, activation);
}

/** An editor's `EditorContext` for the plugin the kind's component answers to, which is the
 *  context the component's `getEditor` reads. */
export function componentPluginEditor(
	pluginEditor: ((pluginName: string) => EditorContext | undefined) | undefined,
	kind: AnyBlockKind
): EditorContext | undefined {
	return pluginEditorFor(pluginEditor, registry.ownerOf(kind));
}

/** The options the kind's component reads: its editor's, or the owning plugin's `defaults` when
 *  no editor is mounted, resolved as an editor with no entry for the plugin would. */
export function componentPluginOptions(
	pluginEditor: ((pluginName: string) => EditorContext | undefined) | undefined,
	kind: AnyBlockKind
): unknown {
	const editor = componentPluginEditor(pluginEditor, kind);
	if (editor) return editor.options;
	const owner = installedPlugin(registry.ownerOf(kind) ?? '') ?? {};
	return resolvePluginOptions(owner, undefined);
}

/** `registerBlockComponent` throws on a duplicate, so a plugin that may register twice (hot
 *  reload, re-import) checks this first. */
export function isBlockComponentRegistered(kind: string): boolean {
	return registry.has(kind as AnyBlockKind);
}

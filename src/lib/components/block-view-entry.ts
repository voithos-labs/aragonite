/** The one place that knows a view's form: what BlockHost renders for a registered view. */

import type { Component } from 'svelte';
import type { HostedBlockExports } from '../block-component';
import type { NodeView } from '../core/node-views';
import { blockViewForm, viewHost, type BlockView } from '../schema/block-view';
import type { SvelteBlockEntry } from './svelte-block-view';
import { drawingOf } from '../schema/drawing';

/** The component BlockHost renders for a view, and the props it adds per node. */
export interface HostedBlockEntry {
	component: Component<Record<string, unknown>, HostedBlockExports>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

export function blockViewEntry(view: BlockView): HostedBlockEntry {
	const form = blockViewForm(view);
	if (form === 'svelte') return view as unknown as SvelteBlockEntry;
	const component = viewHost(view) as HostedBlockEntry['component'];
	const drawing = drawingOf(view);
	return { component, extraProps: () => ({ drawing }) };
}

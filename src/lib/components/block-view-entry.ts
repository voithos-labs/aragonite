/** The one place that knows a view's form: what BlockHost renders for a registered view. */

import type { Component } from 'svelte';
import type { HostedBlockExports } from '../block-component';
import type { NodeView } from '../core/node-views';
import { blockViewForm, domViewSpec, type BlockView } from '../schema/block-view';
import type { SvelteBlockEntry } from './svelte-block-view';
import DomBlockHost from './dom-block-view/DomBlockHost.svelte';
import DrawnBlock from './drawn-block/DrawnBlock.svelte';
import { drawingOf } from '../schema/drawing';

/** The component BlockHost renders for a view, and the props it adds per node. */
export interface HostedBlockEntry {
	component: Component<Record<string, unknown>, HostedBlockExports>;
	extraProps?: (node: NodeView) => Record<string, unknown>;
}

export function blockViewEntry(view: BlockView): HostedBlockEntry {
	const form = blockViewForm(view);
	if (form === 'svelte') return view as unknown as SvelteBlockEntry;
	if (form === 'drawn') {
		const drawing = drawingOf(view);
		return {
			component: DrawnBlock as unknown as HostedBlockEntry['component'],
			extraProps: () => ({ drawing })
		};
	}
	const spec = domViewSpec(view);
	return {
		component: DomBlockHost as unknown as HostedBlockEntry['component'],
		extraProps: () => ({ spec })
	};
}

// Mounting one BlockHost the way BlockList does: a node from a live document, its index, and
// the pair of ref entries the host writes into.

import BlockHost from '$lib/components/BlockHost.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { Document } from '$lib/core/nodes';
import type { NodeView } from '$lib/core/node-views';
import { refSlotsOver, type RefSlots } from '$lib/reactivity/publish-ref.svelte';
import { mountBlock } from '../harness/mount-block';
import type { MountContextOverrides } from '../harness/mount-context';

/** The props a caller sets; the rest are filled in. Pass a `$state` object to
 *  drive a re-dispatch (index shift, byte change) after mount. */
export interface HostProps {
	node?: NodeView;
	index?: number;
	id?: string;
	parentPath?: number[];
	ambientPrefix?: string;
	reorderable?: boolean;
	slots?: RefSlots<BlockComponent>;
}

export interface MountedHost {
	/** The `.block-host` wrapper element. */
	el: HTMLElement;
	/** The array BlockHost writes its child component's ref into. */
	refs: (BlockComponent | undefined)[];
	dispose: () => Promise<void>;
}

/** Mount BlockHost over `doc.children[props.index]`. `props` is filled in place and
 *  handed to `mount` unwrapped, so a `$state` object stays live. */
export function mountBlockHost(
	doc: Document,
	props: HostProps = {},
	overrides: MountContextOverrides = {}
): MountedHost {
	const refs: (BlockComponent | undefined)[] = [];
	props.index ??= 0;
	props.id ??= `block-${props.index}`;
	props.slots ??= refSlotsOver(refs);
	const mounted = mountBlock(BlockHost, {
		doc,
		path: [props.index],
		// Filled at runtime: the declared shape stays all-optional so a caller can hand in a
		// partial `$state` object.
		props: props as Record<string, unknown>,
		overrides
	});
	return {
		el: mounted.target.querySelector('.block-host') as HTMLElement,
		refs,
		dispose: mounted.dispose
	};
}

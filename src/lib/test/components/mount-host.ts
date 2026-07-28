// Mounting one BlockHost the way BlockList does: a node from a live document,
// its index, and the ref slot pair the host publishes into.

import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import BlockHost from '$lib/components/BlockHost.svelte';
import type { BlockComponent } from '$lib/block-component';
import type { Document, PluginBlockKind } from '$lib/core/nodes';
import type { NodeView } from '$lib/core/node-views';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { registerBlockKind } from '$lib/schema/block-kind-descriptor';
import { testClosure } from '$lib/test/support/closure';
import { editorMountContext, type MountContextOverrides } from '../harness/mount-context';

/** BlockHost's measure effect constructs an observer jsdom does not implement. */
export function installBlockHostLayoutStubs(): void {
	(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
}

/** The props a caller sets; the rest are filled in. Pass a `$state` object to
 *  drive a re-dispatch (index shift, byte change) after mount. */
export interface HostProps {
	node?: NodeView;
	index?: number;
	id?: string;
	parentPath?: number[];
	ambientPrefix?: string;
	reorderable?: boolean;
	setRef?: (i: number, r: BlockComponent | undefined) => void;
	getRef?: (i: number) => BlockComponent | undefined;
}

export interface MountedHost {
	/** The `.block-host` wrapper element. */
	el: HTMLElement;
	/** The slot array BlockHost publishes its child component's ref into. */
	refs: (BlockComponent | undefined)[];
	dispose: () => Promise<void>;
}

/**
 * Mount BlockHost over `doc.children[props.index]`. `props` is filled in place
 * and handed to `mount` unwrapped, so a `$state` object stays live.
 */
export function mountBlockHost(
	doc: Document,
	props: HostProps = {},
	overrides: MountContextOverrides = {}
): MountedHost {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const refs: (BlockComponent | undefined)[] = [];
	props.index ??= 0;
	props.node ??= doc.children[props.index];
	props.id ??= `block-${props.index}`;
	props.setRef ??= (i, r) => {
		refs[i] = r;
	};
	props.getRef ??= (i) => refs[i];
	const instance = mount(BlockHost, {
		target,
		// The required props are filled above, but only at runtime — the declared
		// shape stays all-optional so a caller can hand in a partial `$state` object.
		props: props as unknown as ComponentProps<typeof BlockHost>,
		context: editorMountContext({ doc: { doc: () => doc }, ...overrides })
	});
	flushSync();
	return {
		el: target.querySelector('.block-host') as HTMLElement,
		refs,
		dispose: async () => {
			await unmount(instance);
			target.remove();
		}
	};
}

/**
 * A plugin kind carrying only a descriptor. That is the reachable shape of
 * BlockHost's "no component" case: `registryView.descriptor` throws for a kind
 * with no descriptor at all, so a kind that reaches the host always has one.
 */
export function declareComponentlessKind(name: string): PluginBlockKind {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		closure: testClosure
	});
	return kind;
}

// @vitest-environment jsdom
// BlockHost's overlays read every context through `| undefined`, as BlockHost does, since the
// conformance kit mounts without the editor shell. Mounted directly, since mounting through the
// host always supplies a full context.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SelectionOverlay from '#lib/components/SelectionOverlay.svelte';
import DecorationOverlay from '#lib/components/DecorationOverlay.svelte';
import type { Component } from 'svelte';

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
	if (dispose) await dispose();
	dispose = null;
	document.body.innerHTML = '';
});

/** Mount one overlay with no editor context over a detached block element. Both overlays'
 *  "who paints" prop names go in, and each ignores the one it does not declare. */
function mountBare(overlay: Component<never>, isContainer: boolean): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const blockEl = document.createElement('div');
	const instance = mount(overlay as Component<Record<string, unknown>>, {
		target,
		props: {
			path: [0],
			blockRef: undefined,
			blockEl,
			isContainer,
			delegatesPainting: false,
			containerPaintsRects: false
		},
		context: new Map()
	});
	flushSync();
	dispose = async () => {
		await unmount(instance);
		target.remove();
	};
	return target;
}

describe('the block overlays mount without an editor shell', () => {
	const overlays: [string, Component<never>][] = [
		['SelectionOverlay', SelectionOverlay as Component<never>],
		['DecorationOverlay', DecorationOverlay as Component<never>]
	];

	it.each(overlays)('%s mounts over a leaf and paints nothing', (_label, overlay) => {
		const target = mountBare(overlay, false);

		expect(target.querySelector('.selection-overlay')).toBeNull();
		expect(target.querySelector('.decoration-overlay')).toBeNull();
	});

	it.each(overlays)('%s mounts over a container', (_label, overlay) => {
		expect(() => mountBare(overlay, true)).not.toThrow();
	});
});

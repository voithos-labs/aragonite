// @vitest-environment jsdom
//
// BlockHost reads every context through `| undefined` and says why: bare unit
// harnesses and the conformance kit mount it without the editor shell. Its two
// overlays contradicted that — each destructured the services and document facets
// as required, throwing before reaching the optional-chained reads it already
// carries downstream (`selection?.anchor`, `getEditorRoot?.()`, `getDoc?.()`).
// Half-defensive code on both sides of one destructure is what dates the defect.
//
// The overlays are mounted directly rather than through BlockHost: the in-repo
// harness always supplies a full context map (which is why nothing observed this),
// and every leaf component still requires the shell, so a host-level mount cannot
// isolate the overlays' own contract.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import SelectionOverlay from '$lib/components/SelectionOverlay.svelte';
import DecorationOverlay from '$lib/components/DecorationOverlay.svelte';
import type { Component } from 'svelte';

let dispose: (() => Promise<void>) | null = null;
afterEach(async () => {
	if (dispose) await dispose();
	dispose = null;
	document.body.innerHTML = '';
});

/** Mount one overlay with NO editor context, over a detached block element. The
 *  painting-ownership props differ per overlay (BlockHost decides both and hands each
 *  what it reads), so both names ride every mount; a component ignores the one it
 *  does not declare. */
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

// @vitest-environment jsdom
// ListBlock renders its items through its own `{#each}` rather than a BlockList, so every item's
// index, path and key is `bounds.start + localIndex`, which only a window with a nonzero start
// tells apart from the loop index. jsdom has no layout, so the windowed cases stub the two
// measurements the scroll position is mapped through.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ListBlock from '#lib/components/blocks/list/ListBlock.svelte';
import { CURSOR_END } from '#lib/block-component.js';
import { parse } from '#lib/core/parser.js';
import { editorMountContext } from '../../harness/mount-context';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { allowDevWarns } from '#lib/test/support/warn-gate.js';
import { componentAt } from '#lib/block-lists/child-list.js';

// The harness mounts BlockHost without the component layer, so unregistered kinds render raw.
afterEach(() => allowDevWarns(['block-host']));

beforeAll(installLayoutStubs);

/** A scroll container with the geometry jsdom will not compute; `scrollTo` moves it. */
function makeScrollHost() {
	const el = document.createElement('div');
	let scrollTop = 0;
	Object.defineProperty(el, 'clientHeight', { value: 600 });
	Object.defineProperty(el, 'clientWidth', { value: 800 });
	Object.defineProperty(el, 'scrollTop', {
		get: () => scrollTop,
		set: (v: number) => (scrollTop = v)
	});
	el.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
	document.body.appendChild(el);
	return {
		el,
		scrollTo(px: number, listEl: HTMLElement, listHeight: number) {
			listEl.getBoundingClientRect = () => new DOMRect(0, -px, 800, listHeight);
			scrollTop = px;
			el.dispatchEvent(new Event('scroll'));
			flushSync();
		}
	};
}

function mountList(source: string) {
	const doc = parse(source);
	const host = makeScrollHost();
	const target = document.createElement('div');
	host.el.appendChild(target);
	const instance = mount(ListBlock, {
		target,
		props: { node: doc.children[0], index: 0, myPath: [0] },
		context: editorMountContext({ doc: { doc: () => doc, editorRoot: () => host.el } })
	});
	flushSync();
	const listEl = target.querySelector('.list-block') as HTMLElement;
	return {
		instance,
		listEl,
		scrollTo: (px: number) => host.scrollTo(px, listEl, 8000),
		markers: () => [...target.querySelectorAll('.md-marker')].map((m) => m.textContent),
		paths: () =>
			[...target.querySelectorAll('.list-item-block .block-host')].map((h) =>
				h.getAttribute('data-block-path')
			),
		spacers: () =>
			[...target.querySelectorAll('.vr-spacer')].map((s) => (s as HTMLElement).style.height)
	};
}

const LONG_LIST = Array.from({ length: 200 }, (_, i) => `- item ${i}\n`).join('');

let mounted: ReturnType<typeof mountList>;
afterEach(async () => {
	if (mounted) await unmount(mounted.instance);
	document.body.innerHTML = '';
});

describe('list renders its items', () => {
	it('mounts one item per child, each addressed at its absolute document path', () => {
		mounted = mountList('- alpha\n- beta\n- gamma\n');

		expect(mounted.paths()).toEqual(['[0,0,0]', '[0,1,0]', '[0,2,0]']);
		expect(mounted.spacers()).toEqual([]);
	});

	// The marker is part of the item's own bytes, so the list renders it as written, in source
	// order, and never renumbers.
	it('renders ordered markers in source order, from the list start number', () => {
		mounted = mountList('3. gamma\n4. delta\n5. epsilon\n');

		expect(mounted.markers()).toEqual(['3. ', '4. ', '5. ']);
	});

	it('lands container focus in the first item, and CURSOR_END in the last', () => {
		mounted = mountList('- alpha\n- beta\n- gamma\n');
		// Per host, not a flat query: the dimmed marker span is `contenteditable="false"`.
		const surfaces = [...mounted.listEl.querySelectorAll('.block-host')].map((h) =>
			h.querySelector('[contenteditable]')
		);

		mounted.instance.containerApi.focus(0);
		expect(document.activeElement).toBe(surfaces[0]);

		mounted.instance.containerApi.focus(CURSOR_END);
		expect(document.activeElement).toBe(surfaces[2]);
	});

	it('resolves the addressed item, not merely the first one', () => {
		mounted = mountList('- alpha\n- beta\n');

		const second = componentAt(mounted.instance.containerApi.childList(), [1, 0]);

		expect(second?.getCursorOffset).toBeDefined();
		expect(second).not.toBe(componentAt(mounted.instance.containerApi.childList(), [0, 0]));
		expect(componentAt(mounted.instance.containerApi.childList(), [2])).toBeNull();
	});
});

describe('list windows its items', () => {
	it('mounts a slice and reserves the rest of the estimated height as spacers', () => {
		mounted = mountList(LONG_LIST);

		const [top, bottom] = mounted.spacers();
		expect(mounted.paths().length).toBeLessThan(200);
		expect(top).toBe('0px');
		expect(Number.parseFloat(bottom)).toBeGreaterThan(0);
	});

	// With a nonzero window start, `localIndex` in place of `bounds.start + localIndex`
	// renumbers every mounted item's path from zero.
	it('addresses scrolled-in items by absolute index, never the loop index', () => {
		mounted = mountList(LONG_LIST);

		mounted.scrollTo(3000);

		const paths = mounted.paths().map((p) => JSON.parse(p!)[1] as number);
		expect(paths[0]).toBeGreaterThan(0);
		expect(paths).toEqual(paths.map((_, i) => paths[0] + i));
		expect(Number.parseFloat(mounted.spacers()[0])).toBeGreaterThan(0);
	});
});

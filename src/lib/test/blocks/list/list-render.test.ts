// @vitest-environment jsdom
//
// ListBlock is the one container that renders its children through a DIRECT `{#each}` rather
// than a BlockList, so it owns the slice arithmetic itself: every item's index, path and key is
// `bounds.start + localIndex`, and only a window with a nonzero start can tell that apart from
// the loop index. jsdom has no layout, so the windowed cases stub the two geometries the scope
// maps scrollTop through — the same trade `mount-table.ts` makes for caret rects.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ListBlock from '$lib/components/blocks/list/ListBlock.svelte';
import { CURSOR_END } from '$lib/block-component';
import { parse } from '$lib/core/parser';
import { editorMountContext } from '../../harness/mount-context';
import { installLayoutStubs } from '../editor-mount';

beforeAll(installLayoutStubs);

/** A scroll host with the geometry jsdom won't compute; `scrollTo` moves it and reports back. */
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

	// The marker belongs to the item's own bytes, so a renumber is the parser's business — what
	// this pins is that the each-block emits them in source order rather than resequencing.
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

		const second = mounted.instance.containerApi.getBlockComponentByPath([1, 0]);

		expect(second?.getCursorOffset).toBeDefined();
		expect(second).not.toBe(mounted.instance.containerApi.getBlockComponentByPath([0, 0]));
		expect(mounted.instance.containerApi.getBlockComponentByPath([2])).toBeNull();
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

	// ABSOLUTE-INDEX INVARIANT: with a nonzero window start, `localIndex` in place of
	// `bounds.start + localIndex` renumbers every mounted item's path from zero.
	it('addresses scrolled-in items by absolute index, never the loop index', () => {
		mounted = mountList(LONG_LIST);

		mounted.scrollTo(3000);

		const paths = mounted.paths().map((p) => JSON.parse(p!)[1] as number);
		expect(paths[0]).toBeGreaterThan(0);
		expect(paths).toEqual(paths.map((_, i) => paths[0] + i));
		expect(Number.parseFloat(mounted.spacers()[0])).toBeGreaterThan(0);
	});
});

// @vitest-environment jsdom
// A mark's hover comes from hit-testing the pointer against the painted rects, starts once and
// ends once per hover, keyed by the decoration rather than the rect the overlay repaints.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import DecorationOverlay from '#lib/components/overlays/DecorationOverlay.svelte';
import type { BlockComponent } from '#lib/block-component.js';
import { parse } from '#lib/core/parser.js';
import { createDecorationEngine } from '#lib/decorations/decoration-state.svelte.js';
import { createMarkHover, type HoverPointer } from '#lib/decorations/mark-hover.js';
import type { Decoration, MarkDecoration, MarkHover } from '#lib/decorations/types.js';
import { editorMountContext } from '../harness/mount-context';

const doc = parse('hello world, a longer line\n');

/** jsdom measures every range at zero size, so the leaf answers with the rects a browser would:
 *  8px a character, 16px tall, a range crossing `wrapAt` continuing 22px lower. */
function paintingLeaf(wrapAt = Infinity): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: true,
		focusable: true,
		measurePartialRects: (start: number, end: number) =>
			end <= wrapAt || start >= wrapAt
				? [new DOMRect(start * 8, 0, (end - start) * 8, 16)]
				: [new DOMRect(start * 8, 0, (wrapAt - start) * 8, 16), new DOMRect(0, 22, end * 8, 16)]
	} as unknown as BlockComponent;
}

/** A grid's overlay paints its cells' marks as whole-cell rects, 40 by 20. */
function paintingGrid(): BlockComponent {
	return {
		focus: () => {},
		getCursorOffset: () => null,
		editable: false,
		focusable: true,
		cellRect: (row: number, col: number) => new DOMRect(col * 40, row * 20, 40, 20)
	} as unknown as BlockComponent;
}

type HoverCall = { cls: string; hover: MarkHover | null };

let instance: ReturnType<typeof mount> | null = null;
afterEach(async () => {
	if (instance) await unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

function setup(opts: { path?: number[]; leaf?: BlockComponent; container?: boolean } = {}) {
	const path = opts.path ?? [0];
	const errors: { path: number[]; error: unknown }[] = [];
	const engine = createDecorationEngine({
		getDoc: () => doc,
		onMarkError: (errPath, error) => errors.push({ path: errPath, error })
	});
	const target = document.createElement('div');
	// The block's own element sits at the viewport origin in jsdom, so local and viewport agree.
	const blockEl = document.createElement('div');
	blockEl.className = 'block-host';
	document.body.append(target, blockEl);
	instance = mount(DecorationOverlay, {
		target,
		props: {
			path,
			blockRef: opts.leaf ?? paintingLeaf(),
			blockEl,
			isContainer: opts.container ?? false
		},
		context: editorMountContext({ services: { decorations: engine } })
	});
	flushSync();
	const pointer = (x: number, y: number, over: Partial<HoverPointer> = {}) =>
		engine.markHover.move({
			clientX: x,
			clientY: y,
			pointerType: 'mouse',
			buttons: 0,
			target: blockEl,
			...over
		});
	return { engine, errors, pointer, blockEl };
}

/** A source whose answer the test swaps, then re-runs with `invalidate`. Each run settles the
 *  overlay's measure, which lands once the mounting flush is over. */
async function swappableSource(engine: ReturnType<typeof setup>['engine'], first: Decoration[]) {
	let answer = first;
	const handle = engine.addSource({ name: 'probe', provide: () => answer });
	await settle();
	return async (next: Decoration[]) => {
		answer = next;
		handle.invalidate();
		await settle();
	};
}

async function settle(): Promise<void> {
	flushSync();
	await new Promise(requestAnimationFrame);
	flushSync();
}

function hoverMark(calls: HoverCall[], over: Partial<MarkDecoration> = {}): MarkDecoration {
	return {
		type: 'mark',
		path: [0],
		start: 0,
		end: 5,
		class: 'probe',
		interactive: { onHover: (dec, hover) => calls.push({ cls: dec.class, hover }) },
		...over
	};
}

describe('a mark reports one hover per decoration', () => {
	it('reports the rect under the pointer as the anchor, then one end off the mark', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		await swappableSource(engine, [hoverMark(calls)]);

		pointer(10, 8);
		pointer(20, 8);
		pointer(60, 8);

		expect(calls).toHaveLength(2);
		expect(calls[0].hover?.anchor).toMatchObject({ left: 0, top: 0, width: 40, height: 16 });
		expect(calls[0].hover?.rects).toHaveLength(1);
		expect(calls[1].hover).toBeNull();
	});

	it('fires nothing across the space between two lines of a mark, and ends once off it', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup({ leaf: paintingLeaf(3) });
		await swappableSource(engine, [hoverMark(calls)]);

		pointer(4, 8);
		pointer(4, 19);
		pointer(4, 30);
		expect(calls).toHaveLength(1);
		expect(calls[0].hover?.rects).toHaveLength(2);

		pointer(4, 50);
		expect(calls.map((c) => c.hover)).toEqual([calls[0].hover, null]);
	});
});

describe('a started hover ends exactly once, whatever ends it', () => {
	it('survives the source re-providing the same mark, and ends once when it is gone', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		const provide = await swappableSource(engine, [hoverMark(calls)]);
		pointer(10, 8);

		await provide([hoverMark(calls)]);
		await provide([hoverMark(calls, { class: 'probe probe-hovered' })]);
		expect(calls, 'a re-provided mark fired a leave/enter pair').toHaveLength(1);

		await provide([]);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual({ cls: 'probe probe-hovered', hover: null });
	});

	it('ends once when the overlay unmounts, as a block windowed out does', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		await swappableSource(engine, [hoverMark(calls)]);
		pointer(10, 8);

		await unmount(instance!);
		instance = null;
		flushSync();

		expect(calls.map((c) => c.hover === null)).toEqual([false, true]);
	});

	it('routes a throwing onHover to the error sink and keeps reporting later hovers', async () => {
		const calls: HoverCall[] = [];
		const { engine, errors, pointer } = setup();
		const boom: MarkDecoration = {
			...hoverMark(calls),
			interactive: {
				onHover: () => {
					throw new Error('plugin onHover blew up');
				}
			}
		};
		const provide = await swappableSource(engine, [boom]);
		pointer(10, 8);
		pointer(60, 8);
		expect(errors.map((e) => (e.error as Error).message)).toEqual([
			'plugin onHover blew up',
			'plugin onHover blew up'
		]);
		expect(errors[0].path).toEqual([0]);

		await provide([hoverMark(calls)]);
		pointer(10, 8);
		expect(calls).toHaveLength(1);
	});
});

describe('a scroll under a still pointer', () => {
	it('re-runs the check from a scroll anywhere on the page, with no repaint', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer, blockEl } = setup();
		await swappableSource(engine, [hoverMark(calls)]);
		pointer(10, 8);

		// The block moves up under the pointer, as a host scroller or the window scrolling does.
		blockEl.getBoundingClientRect = () => new DOMRect(0, -120, 400, 200);
		const elsewhere = document.createElement('div');
		document.body.append(elsewhere);
		elsewhere.dispatchEvent(new Event('scroll'));

		expect(calls.map((c) => c.hover === null)).toEqual([false, true]);
	});

	it('listens for scrolls only while the pointer is over the editor', async () => {
		const add = vi.spyOn(window, 'addEventListener');
		const remove = vi.spyOn(window, 'removeEventListener');
		const { engine, pointer } = setup();
		const scrolls = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'scroll');

		expect(scrolls(add)).toHaveLength(0);
		pointer(10, 8);
		pointer(12, 8);
		expect(scrolls(add)).toHaveLength(1);
		engine.markHover.leave();
		expect(scrolls(remove)).toHaveLength(1);
		add.mockRestore();
		remove.mockRestore();
	});
});

describe('which pointers hover', () => {
	it('never starts a hover from a touch', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		await swappableSource(engine, [hoverMark(calls)]);

		pointer(10, 8, { pointerType: 'touch' });
		expect(calls).toHaveLength(0);
		pointer(10, 8, { pointerType: 'pen' });
		expect(calls).toHaveLength(1);
	});

	it('ends the hover when a button goes down, and starts none until it is up', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		await swappableSource(engine, [
			hoverMark(calls),
			hoverMark(calls, { start: 6, end: 11, class: 'b' })
		]);

		pointer(10, 8);
		pointer(12, 8, { buttons: 1 });
		pointer(60, 8, { buttons: 1 });
		expect(calls.map((c) => [c.cls, c.hover === null])).toEqual([
			['probe', false],
			['probe', true]
		]);
		pointer(60, 8);
		expect(calls.at(-1)?.cls).toBe('b');
	});

	it('ends the hover over anything outside the blocks, such as a host popup in the root', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup();
		await swappableSource(engine, [hoverMark(calls)]);
		const popup = document.createElement('div');
		document.body.append(popup);

		pointer(10, 8);
		pointer(10, 8, { target: popup });
		expect(calls.map((c) => c.hover === null)).toEqual([false, true]);
	});

	// Miss-analysis: the popup row put its popup outside every block; none covered a menu a block renders inside itself.
	it('ends the hover over a menu a block renders over its own text', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer, blockEl } = setup();
		await swappableSource(engine, [hoverMark(calls)]);
		const menu = document.createElement('div');
		menu.setAttribute('role', 'menu');
		const item = document.createElement('button');
		menu.append(item);
		blockEl.append(menu);

		pointer(10, 8);
		pointer(10, 8, { target: item });
		expect(calls.map((c) => c.hover === null)).toEqual([false, true]);
	});
});

describe('only marks with a click handler take pointer events', () => {
	it('gives hover-only, keyboard-only and plain marks no pointer-taking element', async () => {
		const calls: HoverCall[] = [];
		const { engine } = setup();
		const plain: Decoration[] = Array.from({ length: 200 }, (_, i) => ({
			type: 'mark',
			path: [0],
			start: i % 20,
			end: (i % 20) + 1,
			class: 'plain'
		}));
		const keyboardOnly: MarkDecoration = {
			type: 'mark',
			path: [0],
			start: 0,
			end: 5,
			class: 'kbd',
			interactive: { onActivate: () => {} }
		};
		const clickable: MarkDecoration = {
			...keyboardOnly,
			class: 'click',
			interactive: { onClick: () => {}, onHover: () => {} }
		};
		await swappableSource(engine, [...plain, keyboardOnly, hoverMark(calls), clickable]);

		expect(document.querySelectorAll('.decoration-overlay')).toHaveLength(203);
		const taking = document.querySelectorAll('.decoration-overlay-interactive');
		expect([...taking].map((el) => el.classList.contains('click'))).toEqual([true]);
	});
});

describe('a table cell names its decoration by the precedence rule', () => {
	it('hovers the innermost of the hover marks collapsed into one cell rect', async () => {
		const calls: HoverCall[] = [];
		const { engine, pointer } = setup({ path: [1], leaf: paintingGrid(), container: true });
		const cell = [1, 1, 0];
		await swappableSource(engine, [
			hoverMark(calls, { path: cell, start: 0, end: 3, class: 'outer' }),
			hoverMark(calls, { path: cell, start: 1, end: 2, class: 'inner' }),
			hoverMark(calls, { path: cell, start: 1, end: 2, class: 'later-same-span' })
		]);
		pointer(20, 30);
		expect(calls.map((c) => c.cls)).toEqual(['inner']);
	});

	// Miss-analysis: no test clicked a mark in a table cell; every click-mark row was prose.
	it('keeps a cell clickable when a plain mark from a later source shares it', async () => {
		let clicks = 0;
		const { engine } = setup({ path: [1], leaf: paintingGrid(), container: true });
		engine.addSource({
			name: 'clickable',
			provide: () => [
				{
					type: 'mark',
					path: [1, 1, 0],
					start: 0,
					end: 1,
					class: 'click',
					interactive: { onClick: () => clicks++ }
				}
			]
		});
		engine.addSource({
			name: 'highlight',
			provide: () => [{ type: 'mark', path: [1, 1, 0], start: 0, end: 1, class: 'hl' }]
		});
		flushSync();
		await new Promise(requestAnimationFrame);
		flushSync();
		document
			.querySelector('.decoration-overlay')!
			.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(clicks).toBe(1);
	});

	it("reports a throwing onClick on a cell with the cell's path, not the table's", async () => {
		const { engine, errors } = setup({ path: [1], leaf: paintingGrid(), container: true });
		engine.addSource({
			name: 'boom',
			provide: () => [
				{
					type: 'mark',
					path: [1, 1, 0],
					start: 0,
					end: 1,
					class: 'boom',
					interactive: {
						onClick: () => {
							throw new Error('cell onClick blew up');
						}
					}
				}
			]
		});
		flushSync();
		await new Promise(requestAnimationFrame);
		flushSync();
		document
			.querySelector('.decoration-overlay')!
			.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(errors.map((e) => e.path)).toEqual([[1, 1, 0]]);
	});
});

describe('what a pointer move costs', () => {
	it('identifies the hovered mark once, not on every move inside it', async () => {
		let identifies = 0;
		const dec = hoverMark([]);
		const tracker = createMarkHover({
			identify: (d) => {
				identifies++;
				return { source: 'probe', path: d.path, start: d.start, end: d.end, ordinal: 0 };
			},
			runHandler: (_dec, call) => call()
		});
		const block = document.createElement('div');
		block.className = 'block-host';
		document.body.append(block);
		tracker.paint({}, block, [
			{ mark: { dec, index: 0 }, rects: [{ left: 0, top: 0, width: 40, height: 16 }] }
		]);
		for (const x of [2, 10, 20, 30]) {
			tracker.move({ clientX: x, clientY: 8, pointerType: 'mouse', buttons: 0, target: block });
		}
		expect(identifies).toBe(1);
	});
});

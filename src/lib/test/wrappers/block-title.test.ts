// @vitest-environment jsdom
// A container's drawing gets its title row's own element as `ctx.title`, to point at or place a
// control beside, while the row stays among the children: no `<Slot>` moves it, in React, Vue and
// Svelte. A container with no title row gets null.
// Miss-analysis: `ctx.title` was always null and `<Slot of="title" />` rendered nothing, so no row
// read the anchor a drawing was offered.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { createElement, type ComponentType } from 'react';
import { defineComponent, h, type Component as VueComponent, type PropType } from 'vue';
import { container, definePlugin, QUOTE_LINES } from '#lib/plugin.js';
import { svelteBlock } from '#lib/components/drawn-block/svelte-block.svelte.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { ContainerDrawContext, DrawContext, Drawn } from '#lib/schema/drawing.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { FOLD_LINES, FOLD_SAMPLE, type FoldData } from '#lib/test/support/fold-fixture.js';
import { vueBlock } from '../../../../packages/vue/src/block';
import TitledFrame from '../plugins/fixtures/TitledFrame.svelte';

// The React helper is TSX, which the root type check doesn't compile and Vitest does.
const REACT_BLOCK = '../../../../packages/react/src/block.tsx';
type Draw = (block: Block<never>, ctx: DrawContext) => Drawn<never>;
type SlotProps = { Slot: ComponentType<{ of: 'children' }> };
let reactBlock: (component: ComponentType<SlotProps>) => Draw;

beforeAll(async () => {
	installLayoutStubs();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
	({ reactBlock } = await import(/* @vite-ignore */ REACT_BLOCK));
});
afterEach(destroyMountedEditors);

// A JavaScript caller can still name the title row, which no slot places.
const TITLE = 'title' as 'children';

const ReactFrame = ({ Slot }: SlotProps) =>
	createElement(
		'div',
		{ className: 'frame' },
		createElement(Slot, { of: TITLE }),
		createElement(Slot, { of: 'children' })
	);
const VueFrame = defineComponent({
	props: { Slot: { type: Object as PropType<VueComponent>, required: true } },
	setup: (props) => () =>
		h('div', { class: 'frame' }, [h(props.Slot, { of: TITLE }), h(props.Slot, { of: 'children' })])
});

const HELPERS: [string, () => Draw][] = [
	['reactBlock', () => reactBlock(ReactFrame)],
	['vueBlock', () => vueBlock(VueFrame) as unknown as Draw],
	['svelteBlock', () => svelteBlock(TitledFrame) as unknown as Draw]
];

/** A fold drawn by `draw`, with the context its drawing was last handed. */
function mounted(draw: Draw) {
	const seen: { ctx: ContainerDrawContext | null } = { ctx: null };
	const plugin = definePlugin({
		name: 'frames',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				container<FoldData>({
					name: 'fold',
					label: 'Fold',
					lines: FOLD_LINES,
					sample: FOLD_SAMPLE,
					insert: { none: 'a test block type' },
					draw: (block, ctx) => {
						seen.ctx = ctx;
						return draw(block as Block<never>, ctx) as unknown as Drawn<
							FoldData,
							ContainerDrawContext
						>;
					}
				})
			]
		})
	});
	const m = mountEditor({ source: `${FOLD_SAMPLE}\nafter\n`, plugins: [plugin] });
	flushSync();
	return { m, ctx: () => seen.ctx! };
}

describe.each(HELPERS)('a titled container drawn with %s', (_name, draw) => {
	it('hands the title row’s own element as ctx.title, left among the children', async () => {
		const { m, ctx } = mounted(draw());
		await m.settle();
		const row = surfaceAt(m, [0, 0]);
		expect(ctx().title).toBe(row);
		expect(ctx().children.contains(row)).toBe(true);
		expect(m.target.querySelector('.frame')!.firstElementChild!.contains(ctx().children)).toBe(
			true
		);
	});
});

describe('a titled container’s draw', () => {
	it('finds its title row already in place when draw runs', async () => {
		let atDraw: HTMLElement | null = null;
		const plugin = definePlugin({
			name: 'frames',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					container<FoldData>({
						name: 'fold',
						label: 'Fold',
						lines: FOLD_LINES,
						sample: FOLD_SAMPLE,
						insert: { none: 'a test block type' },
						draw: (_block, ctx) => {
							atDraw = ctx.title;
							const dom = document.createElement('div');
							dom.append(ctx.children);
							return { dom };
						}
					})
				]
			})
		});
		const m = mountEditor({ source: FOLD_SAMPLE, plugins: [plugin] });
		await m.settle();
		expect(atDraw).toBe(surfaceAt(m, [0, 0]));
	});
});

describe('a container with no title row', () => {
	it('hands null as ctx.title', async () => {
		let seen: ContainerDrawContext | null = null;
		const plugin = definePlugin({
			name: 'quotes',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					container({
						name: 'quote',
						label: 'Quote',
						lines: { ...QUOTE_LINES, reads: /^ {0,3}%[ \t]?/, first: '% ', rest: '% ' },
						sample: '% q\n',
						insert: { none: 'a test block type' },
						draw: (_block, ctx) => {
							seen = ctx;
							const dom = document.createElement('div');
							dom.append(ctx.children);
							return { dom };
						}
					})
				]
			})
		});
		const m = mountEditor({ source: '% q\n', plugins: [plugin] });
		await m.settle();
		expect(m.instance.doc.blocks[0].type.name).toBe('quotes/quote');
		expect(seen!.title).toBeNull();
	});
});

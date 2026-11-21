// @vitest-environment jsdom
// A block drawn by a component declares `depends` through its helper's option, as a plain drawing
// does, and the component reads the answers as `ctx.depends`: listed before the first frame and
// again after a heading's key, in React, Vue and Svelte.
// Miss-analysis: a new option; the helpers' `Drawn` carried only `focus`, `keep` and `caret`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { createElement, type ComponentType } from 'react';
import { defineComponent, h, type PropType } from 'vue';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { svelteBlock } from '#lib/components/drawn-block/svelte-block.svelte.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { DrawContext, Drawn } from '#lib/schema/drawing.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { vueBlock } from '../../../../packages/vue/src/block';
import DependsList from '../plugins/fixtures/DependsList.svelte';

// The React helper is TSX, which the root type check doesn't compile and Vitest does.
const REACT_BLOCK = '../../../../packages/react/src/block.tsx';
type Draw = (block: Block, ctx: DrawContext) => Drawn<unknown>;
type Options = { depends?(block: Block): string };
let reactBlock: (component: ComponentType<{ ctx: DrawContext }>, options: Options) => Draw;

beforeAll(async () => {
	installLayoutStubs();
	(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
	({ reactBlock } = await import(/* @vite-ignore */ REACT_BLOCK));
});
afterEach(destroyMountedEditors);

const DOC = '[[keys]]\n\n# Top\n\npara\n\n## Mid\n';
const headingsIn = (block: Block) => (block.text.startsWith('#') ? block.text.trim() : '');
const listed = (ctx: DrawContext) => ctx.depends.filter(Boolean).join('|');

const ReactList = ({ ctx }: { ctx: DrawContext }) => createElement('nav', null, listed(ctx));
const VueList = defineComponent({
	props: { ctx: { type: Object as PropType<DrawContext>, required: true } },
	setup: (props) => () => h('nav', listed(props.ctx))
});

const HELPERS: [string, () => Draw][] = [
	['reactBlock', () => reactBlock(ReactList, { depends: headingsIn })],
	['vueBlock', () => vueBlock(VueList, { depends: headingsIn }) as Draw],
	['svelteBlock', () => svelteBlock(DependsList, { depends: headingsIn }) as Draw]
];

describe.each(HELPERS)('a block drawn with %s and depends', (_name, draw) => {
	it('lists the answers as it mounts, and again after a heading key', async () => {
		const plugin = definePlugin({
			name: 'keys',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock({
						name: 'toc',
						label: 'Keys',
						match: /^\[\[keys\]\]$/,
						sample: '[[keys]]',
						insert: { none: 'a test block type' },
						edit: 'box',
						draw: draw()
					})
				]
			})
		});
		const m = mountEditor({ source: DOC, plugins: [plugin] });
		flushSync();
		const nav = () => m.target.querySelector('nav')?.textContent;
		expect(nav()).toBe('# Top|## Mid');
		typeInto(surfaceAt(m, [1]), '# TopX');
		await m.settle();
		expect(nav()).toBe('# TopX|## Mid');
	});
});

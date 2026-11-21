// @vitest-environment jsdom
// A block type drawn by a component declares `depends` beside `draw`, as any block type does, and
// the component reads the answers as `ctx.depends`: listed as it first renders and again after a
// heading's key, in React, Vue and Svelte.
// Miss-analysis: the answers reached a helper only through an option of its own.
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
let reactBlock: (component: ComponentType<{ ctx: DrawContext }>) => Draw;

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
	['reactBlock', () => reactBlock(ReactList)],
	['vueBlock', () => vueBlock(VueList) as Draw],
	['svelteBlock', () => svelteBlock(DependsList) as Draw]
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
						depends: headingsIn,
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

// @vitest-environment jsdom
// The facts a block maker derives against a bundled leaf kind's hand registration: a twin built with
// `lineBlock` or `fencedBlock` reads the same cut, copy and paste facts, so L8's rewrite of each
// package onto the makers keeps them. A ruled difference is named in its row.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind } from '#lib/core/nodes.js';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { BlockType } from '#lib/schema/plugin-unit.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import { tocPlugin } from '#packages/toc/src/index.js';

beforeAll(() => installLayoutStubs());
// Each test starts with the registries reset, so the hand-registered kinds go in again.
beforeEach(() => installPlugins([latexPlugin(), mermaidPlugin(), parrotPlugin(), tocPlugin()]));
afterEach(destroyMountedEditors);

const picture = () => ({ dom: document.createElement('div') });
const source = (_block: unknown, ctx: { source: HTMLElement }) => {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return { dom };
};

const TWINS: { kind: string; twin: BlockType<unknown> }[] = [
	{
		kind: 'mathBlock',
		twin: fencedBlock({
			name: 'math',
			label: 'Math block',
			fence: [{ info: 'math' }, { open: /^\$\$$/, close: '$$' }],
			sample: '$$\nx\n$$',
			insert: { none: 'a test block type' },
			draw: source
		})
	},
	{
		kind: 'mermaid',
		twin: fencedBlock({
			name: 'mermaid',
			label: 'Diagram',
			fence: { info: 'mermaid' },
			sample: '```mermaid\ngraph TD\n```',
			insert: { none: 'a test block type' },
			edit: 'box',
			draw: picture
		})
	},
	{
		kind: 'parrot',
		twin: lineBlock({
			name: 'parrot',
			label: 'Party parrot',
			match: /^%%parrot(?: (?<text>.*))?$/,
			sample: '%%parrot hi',
			insert: { none: 'a test block type' },
			draw: source
		})
	},
	{
		kind: 'toc',
		twin: lineBlock({
			name: 'toc',
			label: 'Table of contents',
			match: /^\[\[toc\]\]$/,
			sample: '[[toc]]',
			insert: { none: 'a test block type' },
			draw: source
		})
	}
];

describe('a twin made by a block maker', () => {
	it.each(TWINS)('reads $kind’s facts', async ({ kind, twin }) => {
		const twins = definePlugin({
			name: 'twins',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [twin] })
		});
		const m = mountEditor({ source: 'x\n', plugins: [twins] });
		await m.settle();
		const hand = blockFacts(kind);
		const made = blockFacts(twin.name as AnyBlockKind);
		expect(made).toEqual(hand);
	});
});

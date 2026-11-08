// @vitest-environment jsdom
// `Block.body` is the text the author writes, its markers left out, whichever way the block edits.
// Miss-analysis: every `body` read was a text leaf's, so a box falling back to its whole bytes had no row.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { BlockType } from '#lib/schema/plugin-unit.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

let drawn: Block<unknown> | null = null;

function draw(block: Block<unknown>, ctx: { source?: HTMLElement }) {
	drawn = block;
	const dom = document.createElement('div');
	if (ctx.source) dom.append(ctx.source);
	return { dom };
}

const common = { label: 'Demo', insert: { none: 'a test block type' }, draw } as const;
const EDITS = ['text', 'source', 'box'] as const;

const shapes: {
	name: string;
	source: string;
	body: string;
	make(edit: string): BlockType<unknown>;
}[] = [
	{
		name: 'a line block',
		source: '%% the text\n',
		body: 'the text',
		make: (edit) =>
			lineBlock({
				...common,
				name: 'demo',
				match: /^%% (?<text>.*)$/,
				sample: '%% x',
				edit
			} as never)
	},
	{
		name: 'a fenced block',
		source: '```demo\nfirst\nsecond\n```\n',
		body: 'first\nsecond\n',
		make: (edit) =>
			fencedBlock({
				...common,
				name: 'demo',
				fence: { info: 'demo' },
				sample: '```demo\nx\n```',
				edit
			} as never)
	}
];

describe('Block.body', () => {
	for (const shape of shapes) {
		for (const edit of EDITS) {
			it(`is ${shape.name}'s text with edit '${edit}'`, async () => {
				drawn = null;
				const plugin = definePlugin({
					name: 'bodies',
					version: '1.0.0',
					editor: '*',
					contributes: () => ({ blocks: [shape.make(edit)] })
				});
				const editor = mountEditor({ source: shape.source, plugins: [plugin] });
				await editor.settle();
				expect(drawn).not.toBeNull();
				expect(drawn!.body).toBe(shape.body);
			});
		}
	}
});

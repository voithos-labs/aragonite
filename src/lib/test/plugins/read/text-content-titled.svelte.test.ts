// @vitest-environment jsdom
// `Block.textContent` and `Block.body` of a container with a title row, read off a mounted editor:
// the title reads first, as its row shows it (literal, its tags and its name left out), and `body`
// leaves it to `title`.
// Miss-analysis: every container row was a quote or a list, and neither has a title row.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { details } from '#packages/details/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const titled = [
	{
		name: 'an admonition',
		plugin: admonitionsPlugin(),
		source: ':::note My *title*\nbody *text*\n:::\n',
		title: 'My *title*'
	},
	{
		name: 'a details block',
		plugin: details,
		source: '<details>\n<summary>My *title*</summary>\n\nbody *text*\n</details>\n',
		title: 'My *title*'
	}
];

describe('a container with a title row', () => {
	for (const { name, plugin, source, title } of titled) {
		it(`reads ${name}'s title first, as its row shows it, and leaves it out of body`, async () => {
			const m = mountEditor({ source, plugins: [plugin] });
			await m.settle();
			const [block] = m.instance.doc.blocks;
			expect(block.title?.text).toBe(title);
			expect(block.textContent).toBe('My *title*\nbody text');
			expect(block.body).toBe('body *text*');
		});
	}
});

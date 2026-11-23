// @vitest-environment jsdom
// Two editors, one process, the one plugin value, two depths.
// Miss-analysis: no test mounted a second toc instance, so a process-wide depth went unseen.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { PluginList } from '#lib/plugin.js';
import { toc } from '#packages/toc/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

const SOURCE = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n[[toc]]\n';

// A short fixture, so it stays under the windowing watermark and the toc block mounts.
async function mountToc(plugins: PluginList): Promise<HTMLElement> {
	const m = mountEditor({ source: SOURCE, plugins, scrollMode: 'host' });
	await m.settle();
	return m.target;
}

const entryLabels = (root: HTMLElement): string[] =>
	[...root.querySelectorAll('.toc-block-item')].map((el) => el.textContent?.trim() ?? '');

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

describe('toc depth, one editor at a time', () => {
	it('two live editors running the one plugin list different depths', async () => {
		const shallow = await mountToc([toc({ maxDepth: 1 })]);
		const deep = await mountToc([toc({ maxDepth: 3 })]);

		expect(entryLabels(shallow)).toEqual(['One']);
		expect(entryLabels(deep)).toEqual(['One', 'Two', 'Three']);
	});

	it('lists every level with no options', async () => {
		expect(entryLabels(await mountToc([toc]))).toEqual(['One', 'Two', 'Three', 'Four']);
	});

	it('lists to the depth its options give', async () => {
		expect(entryLabels(await mountToc([toc({ maxDepth: 2 })]))).toEqual(['One', 'Two']);
	});

	it('lists every level for a depth outside 1..6', async () => {
		const root = await mountToc([toc({ maxDepth: 99 as never })]);
		expect(entryLabels(root)).toEqual(['One', 'Two', 'Three', 'Four']);
	});
});

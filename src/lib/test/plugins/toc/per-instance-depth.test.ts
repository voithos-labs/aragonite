// @vitest-environment jsdom
// Two editors, one process, one installed toc definition, two depths.
// Miss-analysis: no test mounted a second toc instance, so a process-wide depth went unseen.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EditorPluginEntry } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { tocPlugin } from '$lib/plugins/toc/toc-plugin';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

const SOURCE = '# One\n\n## Two\n\n### Three\n\n#### Four\n\n[[toc]]\n';

// A short fixture, so it stays under the windowing watermark and the toc block mounts.
const mountToc = (plugins: EditorPluginEntry[]): HTMLElement =>
	mountEditor({ source: SOURCE, plugins, scrollMode: 'host' }).target;

const entryLabels = (root: HTMLElement): string[] =>
	[...root.querySelectorAll('.toc-block-item')].map((el) => el.textContent?.trim() ?? '');

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

describe('tocPlugin depth through the per-instance options channel', () => {
	it('two live editors sharing one installed definition list different depths', () => {
		// The same plugin in both props: a second plugin of the same name is discarded in
		// favour of the first, which is what this option exists to work around.
		const toc = tocPlugin();
		const shallow = mountToc([{ plugin: toc, options: { maxDepth: 1 } }]);
		const deep = mountToc([{ plugin: toc, options: { maxDepth: 3 } }]);

		expect(entryLabels(shallow)).toEqual(['One']);
		expect(entryLabels(deep)).toEqual(['One', 'Two', 'Three']);
	});

	it('a bare install with no factory argument lists every level', () => {
		expect(entryLabels(mountToc([tocPlugin()]))).toEqual(['One', 'Two', 'Three', 'Four']);
	});

	it('a bare install still takes the factory argument', () => {
		const root = mountToc([tocPlugin({ maxDepth: 2 })]);
		expect(entryLabels(root)).toEqual(['One', 'Two']);
	});

	it('an instance depth outside 1..6 falls back to the factory argument', () => {
		const toc = tocPlugin({ maxDepth: 2 });
		const root = mountToc([{ plugin: toc, options: { maxDepth: 99 } }]);
		expect(entryLabels(root)).toEqual(['One', 'Two']);
	});
});

// @vitest-environment jsdom
// A plugin's inline read in a mounted editor resolves the document's link reference definitions.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, type EditorContext } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { tocPlugin } from '$lib/plugins/toc';
import { collectHeadings } from '$lib/plugins/toc/heading-outline';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import {
	destroyMountedEditors,
	mountEditor,
	type MountedEditor
} from '$lib/test/harness/mount-editor.svelte';

let editorContext: EditorContext | undefined;
const probe = definePlugin({
	name: 'inline-read-probe',
	setup(ctx) {
		ctx.onEditor((editor) => {
			editorContext = editor;
		});
	}
});

// Short fixtures, so every block stays under the windowing watermark and mounts.
function mountWith(source: string): MountedEditor {
	return mountEditor({
		source,
		plugins: [tocPlugin(), footnotesPlugin(), probe],
		scrollMode: 'host'
	});
}

const shown = (mounted: MountedEditor, selector: string): string[] =>
	[...mounted.target.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');

/** Rewrites `from` to `to` through the editor's replace, one commit like any edit. */
async function replaceText(mounted: MountedEditor, from: string, to: string): Promise<void> {
	const search = mounted.instance.getSearch();
	search.open();
	search.setQuery(from);
	search.setReplacement(to);
	await mounted.settle();
	await search.replaceAll();
	await mounted.settle();
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
	editorContext = undefined;
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

// Miss-analysis: every plugin inline-read test built its reader from a grammar alone, so none
// read a document that holds a link reference definition.
describe('the plugin inline read resolves reference links as the editor draws them', () => {
	it('labels a toc entry by the heading’s link text', async () => {
		const mounted = mountWith('# See [docs][r]\n\n[[toc]]\n\n[r]: /x\n');
		await mounted.settle();
		expect(shown(mounted, '.toc-block-item')).toEqual(['See docs']);
	});

	it('skips a footnote label the editor draws as a reference link’s label', async () => {
		const mounted = mountWith('a [t][^x] b [^y]\n\n[ ^x]: /y\n');
		await mounted.settle();
		expect(shown(mounted, '.footnote-ref')).toEqual(['1']);
	});
});

// Miss-analysis: no test read through a plugin's reader after a commit changed the definitions,
// so a reader holding the definitions it was built with passed.
describe('a reader held across a commit reads the definitions current at the call', () => {
	it('resolves a reference once a commit adds its definition', async () => {
		const mounted = mountWith('# See [docs][r]\n\ntail\n');
		await mounted.settle();
		const read = editorContext!.computeInlineContent;
		const label = () => collectHeadings(editorContext!.document, 6, read)[0].label;
		expect(label()).toBe('See [docs][r]');

		await replaceText(mounted, 'tail', '[r]: /x');

		expect(label()).toBe('See docs');
	});
});

// Miss-analysis: every cache test changed the bytes a plugin had read, never only a definition
// elsewhere in the document, which leaves every block the plugin read untouched.
describe('plugin caches refresh when only a definition changes', () => {
	it('relabels the toc entry', async () => {
		const mounted = mountWith('# See [docs][r]\n\n[[toc]]\n\n[q]: /x\n');
		await mounted.settle();
		expect(shown(mounted, '.toc-block-item')).toEqual(['See [docs][r]']);

		await replaceText(mounted, '[q]', '[r]');

		expect(shown(mounted, '.toc-block-item')).toEqual(['See docs']);
	});

	it('renumbers a footnote reference in an unchanged paragraph', async () => {
		const mounted = mountWith('a [t [^x]][q] b [^y]\n\n[p]: /z\n');
		await mounted.settle();
		expect(shown(mounted, '.footnote-ref')).toEqual(['1']);

		await replaceText(mounted, '[p]', '[q]');

		expect(shown(mounted, '.footnote-ref')).toEqual(['1', '2']);
	});
});

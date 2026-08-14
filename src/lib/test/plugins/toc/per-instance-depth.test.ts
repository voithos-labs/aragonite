// @vitest-environment jsdom
// Two editors, one process, one installed toc definition, two depths.
//
// Miss-analysis: the depth was pinned at the factory argument and at the extraProps closure, both
// of which are process-global by construction — no test mounted a second instance, so nothing
// could observe the first install fixing the depth for the other.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { Editor, type EditorInstance } from '$lib';
import type { EditorPluginEntry } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { tocPlugin } from '$lib/plugins/toc/toc-plugin';

const SOURCE = '# One\n\n## Two\n\n### Three\n\n[[toc]]\n';

const mounted: Array<{ instance: EditorInstance; target: HTMLElement }> = [];

function mountEditor(plugins: EditorPluginEntry[]): HTMLElement {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// `scrollMode: 'host'` keeps windowing off, so the toc block stays mounted.
	const instance = mount(Editor, {
		target,
		props: { source: SOURCE, plugins, scrollMode: 'host' as const }
	}) as EditorInstance;
	flushSync();
	mounted.push({ instance, target });
	return target;
}

const entryLabels = (root: HTMLElement): string[] =>
	[...root.querySelectorAll('.toc-block-item')].map((el) => el.textContent?.trim() ?? '');

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(() => {
	for (const { instance, target } of mounted.splice(0)) {
		void unmount(instance);
		target.remove();
	}
	resetPluginPlatformForTests();
});

describe('tocPlugin depth through the per-instance options channel', () => {
	it('two live editors sharing one installed definition list different depths', () => {
		// The SAME unit in both props: installing a second definition of one name is the
		// first-wins discard this channel exists to route around.
		const toc = tocPlugin();
		const shallow = mountEditor([{ plugin: toc, options: { maxDepth: 1 } }]);
		const deep = mountEditor([{ plugin: toc, options: { maxDepth: 3 } }]);

		expect(entryLabels(shallow)).toEqual(['One']);
		expect(entryLabels(deep)).toEqual(['One', 'Two', 'Three']);
	});

	it('a bare install still takes the factory argument', () => {
		const root = mountEditor([tocPlugin({ maxDepth: 2 })]);
		expect(entryLabels(root)).toEqual(['One', 'Two']);
	});

	it('an instance depth outside 1..6 falls back to the factory argument', () => {
		const toc = tocPlugin({ maxDepth: 2 });
		const root = mountEditor([{ plugin: toc, options: { maxDepth: 99 } }]);
		expect(entryLabels(root)).toEqual(['One', 'Two']);
	});
});

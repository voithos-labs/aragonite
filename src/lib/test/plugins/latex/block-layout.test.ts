// @vitest-environment jsdom
// Which layout a `$$` block opens in: the factory's choice, overridden by an editor's entry.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorPluginEntry } from '$lib/plugin';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

type Probe = { getBlockComponent(path: number[]): { parkCaret?(offset: number): void } | null };

/** Mounts one math block, opens its source, and reads the layout it opened in. */
async function openedLayout(plugins: EditorPluginEntry[]): Promise<string> {
	const mounted = mountEditor<Probe>({ source: '$$\nx\n$$\n', plugins, scrollMode: 'host' });
	mounted.instance.__test.getBlockComponent([0])!.parkCaret!(0);
	await mounted.settle();
	const block = mounted.target.querySelector('.math-block')!;
	expect(block.classList.contains('math-block-editing')).toBe(true);
	if (block.classList.contains('math-block-split')) return 'split';
	if (block.classList.contains('math-block-stacked')) return 'stacked';
	return 'source';
}

beforeEach(() => {
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

describe('the layout a math block opens in', () => {
	it('is side by side on a plain install', async () => {
		expect(await openedLayout([latexPlugin()])).toBe('split');
	});

	it("is the factory's on a bare install", async () => {
		expect(await openedLayout([latexPlugin({ blockLayout: 'source' })])).toBe('source');
	});

	it("is an editor entry's over the factory's, and a bad entry keeps the factory's", async () => {
		const latex = latexPlugin({ blockLayout: 'stacked' });
		expect(await openedLayout([{ plugin: latex, options: { blockLayout: 'source' } }])).toBe(
			'source'
		);
		expect(await openedLayout([{ plugin: latex, options: { blockLayout: 'sideways' } }])).toBe(
			'stacked'
		);
	});
});

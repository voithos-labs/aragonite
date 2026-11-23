// @vitest-environment jsdom
// Which layout a `$$` block opens in: the one its editor's options name.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginsProp } from '#lib';
import { headless } from '#lib/testing.js';
import { latex } from '#packages/latex/src/index.js';
import { destroyMountedEditors, mountEditor } from '#lib/test/harness/mount-editor.svelte.js';

type Probe = { getBlockComponent(path: number[]): { parkCaret?(offset: number): void } | null };

/** Mounts one math block, opens its source, and reads the layout it opened in. */
async function openedLayout(plugins: PluginsProp): Promise<string> {
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
	headless();
});

afterEach(async () => {
	await destroyMountedEditors();
});

describe('the layout a math block opens in', () => {
	it('is side by side on a plain install', async () => {
		expect(await openedLayout([latex])).toBe('split');
	});

	it('is side by side when the options name a layout that is not one', async () => {
		expect(await openedLayout([latex({ blockLayout: 'sideways' as never })])).toBe('split');
	});

	it('is the one the options name', async () => {
		expect(await openedLayout([latex({ blockLayout: 'source' })])).toBe('source');
	});

	// Options laid over options: the last call's layout wins, and an unknown one opens side by side.
	it("is the last call's, and side by side when that one is not a layout", async () => {
		const stacked = latex({ blockLayout: 'stacked' });
		expect(await openedLayout([stacked({ blockLayout: 'source' })])).toBe('source');
		expect(await openedLayout([stacked({ blockLayout: 'sideways' as never })])).toBe('split');
	});
});

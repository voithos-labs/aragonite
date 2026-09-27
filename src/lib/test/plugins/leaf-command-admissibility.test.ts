// @vitest-environment jsdom
// `editor.canRunCommand` on a focused editable-leaf plugin block (block math here) answers what the
// block can run: its moves, and none of the text commands it has no body for.
//
// Miss-analysis: the leaf published a `runCommand` that declined everything, and the read took any
// published `runCommand` as a yes, while no test asked the read about a leaf plugin block.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOOLBAR_COMMANDS } from '$lib';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '$lib/test/harness/mount-editor.svelte';
import { resetPluginPlatformForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

beforeEach(() => {
	resetPluginPlatformForTests();
	installLayoutStubs();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

describe('the admissibility read on a focused editable leaf', () => {
	it('admits the moves and declines the text commands', async () => {
		const mounted = mountEditor<{
			getBlockComponent(path: number[]): { parkCaret?(offset: number): void } | null;
		}>({ source: '$$\nx\n$$\n\npara\n', plugins: [latexPlugin({ renderer: stubRenderer })] });
		mounted.instance.__test.getBlockComponent([0])!.parkCaret!(0);
		await mounted.settle();
		mounted.target.querySelector<HTMLElement>('.math-block-source')!.focus();

		expect(mounted.instance.canRunCommand('block.moveDown')).toBe(true);
		for (const id of Object.values(TOOLBAR_COMMANDS)) {
			expect(mounted.instance.canRunCommand(id), id).toBe(false);
		}
	});
});

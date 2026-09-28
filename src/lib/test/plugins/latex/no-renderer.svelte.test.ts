// @vitest-environment jsdom
// Math installed with no renderer shows each formula's own source, the way mermaid shows its code.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installEditorDomStubsForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

beforeEach(() => {
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
});

describe('latexPlugin with no renderer', () => {
	it('shows block and inline math as their source, naming the missing renderer on hover', async () => {
		const mounted = mountEditor({
			source: '$$\n\\frac{a}{b}\n$$\n\nSee $y^2$ here\n',
			plugins: [latexPlugin()],
			scrollMode: 'host'
		});
		await mounted.settle();

		const block = mounted.target.querySelector<HTMLElement>('.math-block-render > *');
		const inline = mounted.target.querySelector<HTMLElement>('.math-inline-widget > *');
		expect([block?.textContent, inline?.textContent]).toEqual(['\\frac{a}{b}', 'y^2']);
		expect([block?.title, inline?.title]).toEqual([
			'Math renderer not configured',
			'Math renderer not configured'
		]);
	});
});

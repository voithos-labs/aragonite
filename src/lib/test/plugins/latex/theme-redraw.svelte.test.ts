// @vitest-environment jsdom
// Miss-analysis (#243): every math mount test ran under one theme, so no cache key ever missed it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { installEditorDomStubsForTests, resetPluginPlatformForTests } from '$lib/testing';
import { latexPlugin } from '$lib/plugins/latex';
import type { MathRenderer } from '$lib/plugins/latex/math-renderer';
import { destroyMountedEditors, mountEditor } from '$lib/test/harness/mount-editor.svelte';

interface RenderCall {
	source: string;
	display: boolean;
	theme: string | undefined;
}

let calls: RenderCall[] = [];

// Paints the theme into the formula, the way a renderer with its own colors would.
const themedRenderer: MathRenderer = (source, opts) => {
	const { display, theme } = opts as { display: boolean; theme?: string };
	calls.push({ source, display, theme });
	const dom = document.createElement('span');
	dom.textContent = `${theme}:${source}`;
	return { dom };
};

beforeEach(() => {
	calls = [];
	resetPluginPlatformForTests();
	installEditorDomStubsForTests();
});

afterEach(async () => {
	await destroyMountedEditors();
	resetPluginPlatformForTests();
});

describe('an injected math renderer on a theme switch', () => {
	it('redraws block and inline math for the new theme (#243)', async () => {
		const mounted = mountEditor({
			source: '$$\nx\n$$\n\nSee $y$ here\n',
			plugins: [latexPlugin({ renderer: themedRenderer })],
			theme: 'dark',
			scrollMode: 'host'
		});
		await mounted.settle();
		expect(calls.map((c) => c.source)).toEqual(['x', 'y']);

		mounted.props.theme = 'light';
		flushSync();
		await mounted.settle();

		expect(calls.map((c) => c.source)).toEqual(['x', 'y', 'x', 'y']);
		expect(calls).toEqual([
			{ source: 'x', display: true, theme: 'dark' },
			{ source: 'y', display: false, theme: 'dark' },
			{ source: 'x', display: true, theme: 'light' },
			{ source: 'y', display: false, theme: 'light' }
		]);
		const block = mounted.target.querySelector('.math-block-render');
		const inline = mounted.target.querySelector('.math-inline-widget');
		expect([block?.textContent, inline?.textContent]).toEqual(['light:x', 'light:y']);
	});
});

// @vitest-environment jsdom
// A leaf mounted with no editor reads its plugin's defaults through `getOptions`, so a bundled
// leaf reads its options with no cast and no fallback of its own.
// Miss-analysis: no suite mounted a bundled leaf without an editor, so the components each
// guarded an `undefined` that a typed read would have ruled out.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPlugins, parse } from '#lib';
import { resolveBlockSurface } from '#lib/block-component.js';
import { installLayoutStubs } from '#lib/test/harness/mount-editor.svelte.js';
import { settleEditor } from '#lib/test/harness/settle.js';
import { mountBlock, type MountedBlock } from '../harness/mount-block';
import { latexPlugin } from '#lib/plugins/latex/index.js';
import BlockMath from '#lib/plugins/latex/BlockMath.svelte';
import { tocPlugin } from '#lib/plugins/toc/index.js';
import TocBlock from '#lib/plugins/toc/TocBlock.svelte';
import type { MathRenderer } from '#lib/plugins/latex/math-renderer.js';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });

let mounted: MountedBlock<unknown> | null = null;

beforeEach(() => {
	installLayoutStubs();
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await mounted?.dispose();
	mounted = null;
});

describe('a leaf mounted with no editor reads its plugin defaults', () => {
	it("opens a math block in the latex plugin's default layout", async () => {
		installPlugins([latexPlugin({ renderer: stubRenderer, blockLayout: 'stacked' })]);
		const block = mountBlock(BlockMath, { source: '$$\nx\n$$\n' });
		mounted = block;

		resolveBlockSurface(block.instance)?.focus(3);
		await settleEditor();

		const root = block.target.querySelector('.math-block');
		expect(root?.classList.contains('math-block-editing')).toBe(true);
		expect(root?.classList.contains('math-block-stacked')).toBe(true);
	});

	it("lists headings down to the toc plugin's default depth", async () => {
		installPlugins([tocPlugin({ maxDepth: 2 })]);
		const doc = parse('# a\n\n## b\n\n### c\n\n[[toc]]\n');
		mounted = mountBlock(TocBlock, { doc, path: [3], props: { document: doc } });
		await settleEditor();

		const items = [...mounted.target.querySelectorAll('.toc-block-item')].map((b) =>
			b.textContent?.trim()
		);
		expect(items).toEqual(['a', 'b']);
	});
});

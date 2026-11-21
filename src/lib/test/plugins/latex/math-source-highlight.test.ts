// @vitest-environment jsdom
// Block math's shown source paints its LaTeX through the editor's highlighters: tokens once the
// highlight package's LaTeX grammar arrives.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { highlight } from '#packages/highlight/src/index.js';
import { highlightJs } from '#packages/highlight/src/renderer.js';
import type { MathRenderer } from '#packages/latex/src/math-renderer.js';

const stubRenderer: MathRenderer = () => ({ dom: document.createElement('span') });
const SOURCE = '$$\n\\frac{a}{b} % half\n$$\n';

beforeEach(() => {
	installLayoutStubs();
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});
afterEach(async () => {
	await destroyMountedEditors();
});

type Seam = { getBlockComponent(path: number[]): { focus?(offset: number): void } };

async function enterMathSource(withPackage: boolean) {
	const latex = latexPlugin({ renderer: stubRenderer });
	const mounted = mountEditor<Seam>({
		source: SOURCE,
		plugins: withPackage ? [latex, highlight({ renderer: highlightJs() })] : [latex]
	});
	await mounted.settle();
	mounted.instance.__test.getBlockComponent([0]).focus?.(3);
	await mounted.settle();
	const source = mounted.target.querySelector<HTMLElement>('.math-block-source')!;
	return { mounted, source };
}

const tokenClasses = (el: HTMLElement) =>
	[...el.querySelectorAll('[class^="code-tok-"]')].map((span) => span.className);

describe('block math source painting', () => {
	it('paints LaTeX tokens once the grammar arrives, the caret where it was', async () => {
		const { mounted, source } = await enterMathSource(true);
		expect(source.textContent).toBe(SOURCE.trimEnd());
		await expect.poll(() => tokenClasses(source).length).toBeGreaterThan(0);
		expect(tokenClasses(source)).toContain('code-tok-comment');
		expect(source.textContent).toBe(SOURCE.trimEnd());
		expect(mounted.source()).toBe(SOURCE);
	});

	it("paints with the core's own languages without the highlight package", async () => {
		const { source } = await enterMathSource(false);
		expect(source.textContent).toBe(SOURCE.trimEnd());
		expect(tokenClasses(source)).toContain('code-tok-comment');
	});
});

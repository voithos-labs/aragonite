// @vitest-environment jsdom
// One formula repeated through a document renders once per form, however many blocks show it.
// Miss-analysis: the cache rows called the renderings directly, so no row mounted an editor full
// of one formula and counted what its renderer drew.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { latex, type MathRenderer } from '#packages/latex/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

describe('a formula the document repeats', () => {
	it('renders once inline and once displayed across 500 copies', async () => {
		const renderer = vi.fn<MathRenderer>(() => ({ dom: document.createElement('span') }));
		const source = 'see $x^2$ here\n\n$$x^2$$\n\n'.repeat(250);
		const editor = mountEditor({ source, plugins: [latex({ renderer })] });
		await editor.settle();

		expect(editor.target.querySelectorAll('.math-inline-widget').length).toBeGreaterThan(1);
		expect(editor.target.querySelectorAll('.math-block-render').length).toBeGreaterThan(1);
		expect(renderer.mock.calls.map(([formula, { display }]) => [formula, display])).toEqual([
			['x^2', false],
			['x^2', true]
		]);
	});
});

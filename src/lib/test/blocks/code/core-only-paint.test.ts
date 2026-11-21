// @vitest-environment jsdom
// Miss-analysis: every mounted code test ran with the core's own grammars, so none showed what a
// core-only editor paints.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { highlight } from '#packages/highlight/src/index.js';
import { highlightJs } from '#packages/highlight/src/renderer.js';

const SOURCE = '```js\nconst x = 42; // the answer\n```\n';

beforeEach(() => installLayoutStubs());
afterEach(async () => {
	await destroyMountedEditors();
});

async function codeBody(withPackage: boolean) {
	const mounted = mountEditor({
		source: SOURCE,
		plugins: withPackage ? [highlight({ renderer: highlightJs() })] : undefined
	});
	await mounted.settle();
	const block = mounted.target.querySelector<HTMLElement>('[data-block-kind="fencedCode"]')!;
	return { mounted, block };
}

const tokens = (el: HTMLElement) =>
	[...el.querySelectorAll('[class^="code-tok-"]')].map((s) => `${s.className}:${s.textContent}`);

describe('a code block in a core-only editor', () => {
	it('paints its body plain, every byte kept', async () => {
		const { mounted, block } = await codeBody(false);
		expect(tokens(block)).toEqual([]);
		expect(block.textContent).toContain('const x = 42; // the answer');
		expect(mounted.source()).toBe(SOURCE);
	});

	// Miss-analysis: the mounted rows compared flat token lists, which say nothing of which of two
	// spans over one word is inside, and the inner one's colour is the one painted.
	it('paints a JSON literal as 0.11.5 did, the keyword inside the literal', async () => {
		const mounted = mountEditor({
			source: '```json\n[true]\n```\n',
			plugins: [highlight({ renderer: highlightJs() })]
		});
		await mounted.settle();
		const inner = mounted.target.querySelector('.code-tok-literal > .code-tok-keyword');
		expect(inner?.textContent).toBe('true');
	});

	it('paints tokens once the highlight package is listed', async () => {
		const { block } = await codeBody(true);
		expect(tokens(block)).toEqual([
			'code-tok-keyword:const',
			'code-tok-number:42',
			'code-tok-comment:// the answer'
		]);
	});
});

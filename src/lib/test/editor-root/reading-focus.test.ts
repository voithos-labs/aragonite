// @vitest-environment jsdom
// Reading mode keeps one tab stop, the block whose own element last took focus, and each block
// reads as text rather than as a field; the editing modes leave every block its own stop.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import {
	installLayoutStubs,
	mountEditor,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { tabOrder } from '#lib/testing.js';
import { definePlugin } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import PlainLeafBlock from '../plugins/fixtures/PlainLeafBlock.svelte';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';

beforeAll(installLayoutStubs);

let mounted: MountedEditor | null = null;
afterEach(async () => {
	if (mounted) await mounted.destroy();
	mounted = null;
});

const plainLeaf = definePlugin({
	name: 'reading-focus-plain-leaf',
	setup: () => {
		testLeaf('reading-focus-plain-leaf', (kind) => ({
			opener: {
				priority: 25,
				interruptsParagraph: false,
				tryOpen: (ctx) =>
					ctx.line.text.startsWith('@@ ')
						? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
						: null
			},
			view: svelteBlockView(PlainLeafBlock)
		}));
	}
});

const DOC = [
	'## Heading',
	'A [link](https://example.com) here.',
	'> quoted',
	'```js\nx\n```',
	'| a | b |\n| --- | --- |\n| c | d |',
	'---'
].join('\n\n');

function root(): HTMLElement {
	return mounted!.target.querySelector<HTMLElement>('.editor')!;
}

/** Every element in the tab order that isn't a link or a button, by its block's path. */
function blockStops(): string[] {
	return [...root().querySelectorAll<HTMLElement>('[tabindex]')]
		.filter((el) => el.tabIndex >= 0 && !el.matches('a, button'))
		.map((el) => el.closest('[data-block-path]')?.getAttribute('data-block-path') ?? '?');
}

function leaf(path: string): HTMLElement {
	const host = root().querySelector(`[data-block-path="${path}"]`)!;
	return host.querySelector<HTMLElement>(
		'.text-editable-block, .code-block, .table-cell, .whole-block-input'
	)!;
}

describe('reading mode keeps one tab stop', () => {
	it('is the first block before anything is focused', async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		expect(blockStops()).toEqual(['[0]']);
		expect(tabOrder(root())).toBeNull();
	});

	it("moves to a block whose own element takes focus, a cell or a divider's host included", async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		for (const path of ['[2,0]', '[3]', '[4]', '[5]']) {
			leaf(path).focus();
			flushSync();
			expect(blockStops()).toEqual([path]);
		}
	});

	it('stays put when focus lands on a link inside a block', async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		root().querySelector<HTMLElement>('a[href]')!.focus();
		flushSync();

		expect(blockStops()).toEqual(['[0]']);
	});

	it("covers a plugin's editable leaf, which renders no tabindex of its own", async () => {
		mounted = mountEditor({
			source: 'First.\n\n@@ leaf text\n',
			presentationMode: 'reading',
			plugins: [plainLeaf]
		});
		await mounted.settle();

		expect(root().querySelector('.plain-leaf-block')?.getAttribute('tabindex')).toBe('-1');
		root().querySelector<HTMLElement>('.plain-leaf-block')!.focus();
		flushSync();
		expect(blockStops()).toEqual(['[1]']);
	});

	it('reports a block that puts itself in the tab order, and a dev build says so', async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		root().querySelector<HTMLElement>('[data-block-path="[2]"]')!.tabIndex = 0;
		expect(tabOrder(root())).toMatch(/2 tab stops that aren't controls/);

		leaf('[1]').focus();
		await mounted.settle();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['invariant:reading-tab-stops']);
	});

	it('reports an element left editable in a block, and leaves the host header alone', async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		const header = document.createElement('div');
		header.setAttribute('data-host-content', '');
		header.innerHTML = '<div tabindex="0"></div><div contenteditable="true"></div>';
		root().append(header);
		expect(tabOrder(root())).toBeNull();

		const field = document.createElement('div');
		field.setAttribute('contenteditable', 'true');
		root().querySelector('[data-block-path="[2]"]')!.append(field);
		expect(tabOrder(root())).toMatch(/2 tab stops that aren't controls/);
	});
});

describe('the editing modes leave every block its own tab stop', () => {
	it('source mode: every block at 0, whatever took focus', async () => {
		mounted = mountEditor({ source: DOC });
		await mounted.settle();
		leaf('[1]').focus();
		flushSync();

		expect(blockStops()).toEqual(['[0]', '[1]', '[2,0]', '[3]', '[4]', '[4]', '[4]', '[4]', '[5]']);
	});
});

describe('a block reads as text in reading mode, not as a field', () => {
	it('a heading is a heading of its level, a paragraph has no role or name', async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		const heading = leaf('[0]');
		expect(heading.getAttribute('role')).toBe('heading');
		expect(heading.getAttribute('aria-level')).toBe('2');
		expect(heading.hasAttribute('aria-label')).toBe(false);
		const paragraph = leaf('[1]');
		expect(paragraph.hasAttribute('role')).toBe(false);
		expect(paragraph.hasAttribute('aria-label')).toBe(false);
		expect(paragraph.hasAttribute('aria-readonly')).toBe(false);
	});

	it("a divider's host is a named group once focused", async () => {
		mounted = mountEditor({ source: DOC, presentationMode: 'reading' });
		await mounted.settle();

		const host = leaf('[5]');
		host.focus();

		expect(host.getAttribute('role')).toBe('group');
		expect(host.getAttribute('aria-label')).toBe('Divider');
	});

	it('source mode keeps the textbox and its name', async () => {
		mounted = mountEditor({ source: DOC });
		await mounted.settle();

		expect(leaf('[1]').getAttribute('role')).toBe('textbox');
		expect(leaf('[1]').getAttribute('aria-label')).toBe('Paragraph');
	});
});

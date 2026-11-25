import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { PluginsPage, readContainer, type ContainerState } from './helpers';

// Select-all over a document that is one container, then a removal: the container keeps its
// opening, emptied. Each document names where the caret starts before Ctrl+A twice.

interface Lone {
	name: string;
	seed: 'admonitions' | 'details';
	source: string;
	caret: [number[], number];
	/** What Backspace, Delete, Enter and a cut leave. */
	emptied: string;
	/** What a letter typed over the range leaves, where a row pins it. */
	typed?: string;
	/** What Enter leaves, where it differs from the removal's bytes. */
	enter?: string;
}

/** The container's kind and blocks, read off the tree, its bytes aside. */
async function shapeOf(page: Page): Promise<Omit<ContainerState, 'raw'>> {
	const { raw: _bytes, ...shape } = await readContainer(page);
	return shape;
}

const ALL_REMOVALS = ['Backspace', 'Delete', 'Enter', 'ControlOrMeta+x'] as const;

const FIXED: Lone[] = [
	{
		name: 'a lone emptied callout',
		seed: 'admonitions',
		source: ':::tip Title\n\n:::\n',
		caret: [[0, 0], 12],
		emptied: ':::tip \n\n:::\n',
		typed: ':::tip Q\n\n:::\n'
	},
	{
		name: 'a lone emptied callout with no title',
		seed: 'admonitions',
		source: ':::tip\n\n:::\n',
		caret: [[0, 0], 6],
		emptied: ':::tip\n\n:::\n'
	},
	{
		name: 'a lone emptied callout in a quote',
		seed: 'admonitions',
		source: '> :::tip Title\n>\n> :::\n',
		caret: [[0, 0, 0], 12],
		emptied: '> :::tip \n>\n> :::\n'
	},
	{
		name: 'a lone emptied callout in a list item',
		seed: 'admonitions',
		source: '- :::tip Title\n\n  :::\n',
		caret: [[0, 0, 0, 0], 12],
		emptied: '- :::tip \n\n  :::\n'
	},
	{
		name: 'a lone emptied generic container',
		seed: 'admonitions',
		source: ':::foo Title\n\n:::\n',
		caret: [[0, 0], 12],
		emptied: ':::foo \n\n:::\n'
	},
	{
		name: 'a lone details with a body',
		seed: 'details',
		source: '<details open>\n<summary>D</summary>\n\nx\n</details>\n',
		caret: [[0, 1], 1],
		emptied: '<details open>\n<summary></summary>\n\n</details>\n',
		typed: '<details open>\n<summary>Q</summary>\n\n</details>\n'
	},
	{
		name: 'a lone details in a quote',
		seed: 'details',
		source: '> <details open>\n> <summary>D</summary>\n>\n> x\n> </details>\n',
		caret: [[0, 0, 1], 1],
		emptied: '> <details open>\n> <summary></summary>\n> \n> </details>\n'
	},
	{
		name: 'a lone details in a list item',
		seed: 'details',
		source: '- <details open>\n  <summary>D</summary>\n\n  x\n  </details>\n',
		caret: [[0, 0, 0, 1], 1],
		emptied: '- <details open>\n  <summary></summary>\n  \n  </details>\n',
		typed: '- <details open>\n  <summary>Q</summary>\n  \n  </details>\n'
	}
];

// Today's answers, pinned: a lone callout with a body, a lone emptied details, and a container
// beside another block.
const CONTROLS: Lone[] = [
	{
		name: 'a lone callout with a body',
		seed: 'admonitions',
		source: ':::tip Title\nbody\n:::\n',
		caret: [[0, 1], 2],
		emptied: ':::tip \n\n:::\n'
	},
	{
		name: 'a lone emptied details',
		seed: 'details',
		source: '<details open>\n<summary>D</summary>\n\n\n</details>\n',
		caret: [[0, 1], 0],
		emptied: '<details open>\n<summary></summary>\n\n\n</details>\n'
	},
	{
		name: 'a callout then an empty line',
		seed: 'admonitions',
		source: ':::tip Title\nbody\n:::\n\n\n',
		caret: [[0, 1], 2],
		emptied: ':::tip \n\n:::\n\n\n'
	},
	{
		name: 'an emptied callout then an empty line',
		seed: 'admonitions',
		source: ':::tip Title\n\n:::\n\n\n',
		caret: [[0, 0], 12],
		emptied: ':::tip \n\n:::\n\n\n'
	},
	{
		name: 'a lone emptied callout nested in a note',
		seed: 'admonitions',
		source: '::::note Outer\n:::tip Inner\n\n:::\n::::\n',
		caret: [[0, 1, 0], 12],
		emptied: '::::note \n::::\n',
		enter: '::::note \n\n::::\n'
	},
	{
		name: 'a callout then a paragraph',
		seed: 'admonitions',
		source: ':::tip Title\nbody\n:::\n\npara\n',
		caret: [[0, 1], 2],
		emptied: '\n',
		enter: '\n\n'
	},
	{
		name: 'a paragraph then a callout',
		seed: 'admonitions',
		source: 'para\n\n:::tip Title\nbody\n:::\n',
		caret: [[0], 2],
		emptied: '\n',
		enter: '\n\n'
	}
];

test.describe('select-all over a document that is one container', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
	});

	async function selectAllIn(lone: Lone, mode: 'live' | 'source'): Promise<void> {
		await editor.gotoPlugins(lone.seed);
		await editor.setPresentationMode(mode);
		await editor.loadContent(lone.source);
		await editor.focusBlockAtPath(...lone.caret);
		await editor.selectAll();
		await editor.selectAll();
		await editor.waitForCrossBlock(true);
	}

	for (const mode of ['live', 'source'] as const) {
		for (const lone of [...FIXED, ...CONTROLS]) {
			for (const key of ALL_REMOVALS)
				test(`${mode}: ${lone.name}, ${key}`, async ({ page }) => {
					await selectAllIn(lone, mode);
					await page.keyboard.press(key);
					await editor.bridge.waitForSourceEquals(
						key === 'Enter' ? (lone.enter ?? lone.emptied) : lone.emptied
					);
					expect(await editor.parseConverged()).toBe(true);
				});

			test(`${mode}: ${lone.name}, cut then pasted back`, async ({ page }) => {
				await selectAllIn(lone, mode);
				await page.keyboard.press('ControlOrMeta+x');
				await editor.bridge.waitForSourceEquals(lone.emptied);
				await editor.paste();
				await editor.bridge.waitForSourceEquals(lone.source);
			});

			const { typed } = lone;
			if (typed)
				test(`${mode}: ${lone.name}, a letter`, async ({ page }) => {
					await selectAllIn(lone, mode);
					await page.keyboard.type('Q');
					await editor.bridge.waitForSourceEquals(typed);
				});
		}

		test(`${mode}: an emptied details reads back as the lone emptied details, caret in the summary`, async ({
			page
		}) => {
			await selectAllIn(
				FIXED.find((l) => l.name === 'a lone details with a body')!,
				mode
			);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(
				'<details open>\n<summary></summary>\n\n</details>\n'
			);
			expect((await editor.bridge.getSelection())?.focus.path).toEqual([0, 0]);
			expect(await editor.parseConverged()).toBe(true);
			const emptied = await shapeOf(page);

			await selectAllIn(
				CONTROLS.find((l) => l.name === 'a lone emptied details')!,
				mode
			);
			await page.keyboard.press('Backspace');
			await editor.bridge.waitForSourceEquals(
				'<details open>\n<summary></summary>\n\n\n</details>\n'
			);
			expect(await shapeOf(page)).toEqual(emptied);
		});
	}
});

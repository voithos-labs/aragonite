import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage, dragBetweenPoints } from '../plugins/helpers';
import { pointAtRaw, textRunRect } from '../../text-runs';

// A click in the margin beside a container's later line lands on that line, at every depth and
// for every container kind. Requirements: `e2e/requirements/selection/dead-space-click-containers.md`.

interface Case {
	name: string;
	/** The `/test/plugins` seed for a plugin container; the plain editor harness otherwise. */
	seed?: string;
	doc: string;
	/** The container whose own edge a click aims at, where that edge is clickable margin. */
	container?: number[];
	/** The line the clicks are level with, which is never the container's first. */
	line: string;
	/** Where the clicks aim, every one of them left of the line's text. */
	aims: Aim[];
}

type Aim = 'at the editor edge' | 'at the container edge' | 'just left of the text';

const CASES: Case[] = [
	{
		name: 'a quote',
		doc: 'Before\n\n> first quoted line\n>\n> second quoted line\n>\n> third quoted line\n\nAfter\n',
		container: [1],
		line: 'third quoted line',
		aims: ['at the editor edge', 'at the container edge', 'just left of the text']
	},
	{
		name: 'a nested list',
		doc: 'Before\n\n- one\n- two\n  - nested a\n  - nested b\n\nAfter\n',
		line: 'nested b',
		// The nested list's indent holds the line's drag handle, and its text box starts right
		// after, so the editor's edge is the only margin beside the line.
		aims: ['at the editor edge']
	},
	{
		name: 'an alert',
		seed: 'admonitions',
		doc: 'Before\n\n> [!NOTE]\n> first body\n>\n> second body\n\nAfter\n',
		line: 'second body',
		aims: ['at the editor edge']
	},
	{
		name: 'a footnote',
		seed: 'footnotes',
		doc: 'Before[^1]\n\n[^1]: first note\n\n    second note para\n\nAfter\n',
		line: 'second note para',
		aims: ['at the editor edge']
	},
	{
		name: 'a details body',
		seed: 'details',
		doc: '<details open>\n<summary>Sum</summary>\n\nfirst body\n\nsecond body\n\n</details>\n\nAfter\n',
		line: 'second body',
		aims: ['at the editor edge']
	}
];

async function aimX(page: Page, aim: Aim, row: Case): Promise<number> {
	if (aim === 'at the editor edge') {
		return page.evaluate(
			() => (document.querySelector('.editor') as HTMLElement).getBoundingClientRect().left + 2
		);
	}
	if (aim === 'at the container edge') {
		const box = await page
			.locator(`[data-block-path='${JSON.stringify(row.container ?? [])}']`)
			.boundingBox();
		if (!box) throw new Error(`no box for ${row.name}`);
		return box.x + 1;
	}
	return (await textRunRect(page, row.line)).left - 3;
}

for (const row of CASES) {
	for (const mode of ['source', 'live']) {
		for (const aim of row.aims) {
			test(`${mode}: a click ${aim} beside ${row.name}'s later line lands on it`, async ({
				page
			}) => {
				const editor = row.seed ? new PluginsPage(page) : new EditorPage(page);
				if (editor instanceof PluginsPage) await editor.gotoPlugins(row.seed);
				else await editor.goto();
				await editor.loadContent(row.doc);
				await editor.setPresentationMode(mode);

				const text = await textRunRect(page, row.line);
				await page.mouse.click(await aimX(page, aim, row), text.top + text.height / 2);
				await editor.waitForRenderFlush();
				await page.keyboard.type('Z');

				// Every aim is left of the line's text, so the caret lands where that text starts.
				await editor.bridge.waitForSourceContains('Z');
				expect(await editor.bridge.getSource()).toBe(row.doc.replace(row.line, `Z${row.line}`));
			});
		}
	}
}

// A drag resolves its moving end through its own lookup, so a drag into the same margin has to
// land where the click does. Off every block and on the quote's own box are separate branches.
const QUOTE = CASES[0];
for (const aim of QUOTE.aims) {
	test(`a drag released ${aim} beside a quote's later line ends where a click there lands`, async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(QUOTE.doc);
		const text = await textRunRect(page, QUOTE.line);
		const beside = { x: await aimX(page, aim, QUOTE), y: text.top + text.height / 2 };
		await page.mouse.click(beside.x, beside.y);
		const clicked = await editor.bridge.getSelection();
		expect(clicked?.focus.path).toEqual([1, 2]);

		const start = await pointAtRaw(page, [0], 0);
		await dragBetweenPoints(page, start, beside);
		await editor.waitForRenderFlush();

		const dragged = await editor.bridge.getSelection();
		expect(dragged?.anchor).toEqual({ path: [0], offset: 0 });
		expect(dragged?.focus).toEqual(clicked?.focus);
	});
}

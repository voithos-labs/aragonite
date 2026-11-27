import { type Locator, type Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { gotoReady } from '../../goto-ready';
import { clickInPlace } from '../../click-in-place';
import { PluginsPage } from './helpers';
import { END_SLACK, wheelToBottom } from './end-scroll-helpers';

/**
 * A drawing at the end of a windowed document that is a moment shorter while its `update` rebuilds
 * it costs the reader nothing (requirements/plugins/update-shrink-end-scroll.md): for each change
 * the editor brings with the caret elsewhere, in both scroll modes, the scroll position holds.
 */

const FILLER = Array.from(
	{ length: 150 },
	(_, i) =>
		`Paragraph ${i} of filler prose, long enough to wrap onto a second line in the narrow harness.`
).join('\n\n');

const LAST_PARAGRAPH = 'Paragraph 149 of filler';

interface Change {
	name: string;
	open: boolean;
	/** The end, for a change that leaves the document no taller; else the same scroll position. */
	keeps: 'end' | 'scrollTop';
	/** Puts the caret where the change needs it, before the position is read. */
	prepare(page: Page, box: Locator): Promise<void>;
	run(editor: PluginsPage, box: Locator): Promise<void>;
}

const caretAbove = (page: Page) => clickInPlace(page.locator('.editor').getByText(LAST_PARAGRAPH));

const CHANGES: Change[] = [
	{
		name: 'switching to reading mode',
		open: true,
		keeps: 'end',
		prepare: caretAbove,
		run: (editor) => editor.setPresentationMode('reading')
	},
	{
		name: 'switching the theme',
		open: true,
		keeps: 'end',
		prepare: caretAbove,
		run: (editor) => clickInPlace(editor.page.getByTestId('theme-toggle'))
	},
	{
		name: 'the caret leaving the block',
		open: true,
		keeps: 'end',
		async prepare(page, box) {
			await clickInPlace(box.getByText('body line'));
			await expect(box).toHaveAttribute('data-caret-in', 'true');
		},
		async run(editor, box) {
			await caretAbove(editor.page);
			await expect(box).toHaveAttribute('data-caret-in', 'false');
		}
	},
	{
		name: 'opening its fold',
		open: false,
		keeps: 'scrollTop',
		prepare: caretAbove,
		async run(_editor, box) {
			const toggle = box.locator('.shrink-toggle');
			await clickInPlace(toggle);
			await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		}
	}
];

interface Position {
	scrollTop: number;
	maxScrollTop: number;
	windowed: boolean;
	updates: number;
}

function position(page: Page, portSelector: string): Promise<Position> {
	return page.evaluate((sel) => {
		const port = document.querySelector(sel) as HTMLElement;
		const box = document.querySelector('.shrink-box') as HTMLElement;
		return {
			scrollTop: port.scrollTop,
			maxScrollTop: port.scrollHeight - port.clientHeight,
			windowed: document.querySelector('.editor .vr-spacer') !== null,
			updates: Number(box.dataset.updates)
		};
	}, portSelector);
}

test.describe('a drawing a moment shorter on update keeps the reader at the end', () => {
	for (const scrollMode of ['self', 'host'] as const) {
		const portSelector = scrollMode === 'host' ? '.plugins-harness' : '.editor';
		for (const change of CHANGES) {
			test(`${change.name}, ${scrollMode} scroll`, async ({ page }) => {
				const editor = new PluginsPage(page);
				await gotoReady(page, `/test/plugins?seed=shrink&scroll=${scrollMode}`);
				const opening = change.open ? '[shrink open]' : '[shrink]';
				await editor.loadContent(
					`${FILLER}\n\n${opening}\ntitle: Shrink\n\nbody line\n\n[/shrink]\n`
				);
				const port = page.locator(portSelector);
				const box = page.locator('.shrink-box');
				await wheelToBottom(page, port);
				await change.prepare(page, box);
				// Any update the caret's own move brought is behind the reading, not in it.
				await wheelToBottom(page, port);
				await editor.waitForRenderFlush();
				const before = await position(page, portSelector);
				// A fixture that stopped windowing would pass for nothing.
				expect(before.windowed).toBe(true);
				expect(before.maxScrollTop - before.scrollTop).toBeLessThan(END_SLACK);

				await change.run(editor, box);
				// Nor would a change the drawing never heard.
				await expect
					.poll(async () => (await position(page, portSelector)).updates)
					.toBeGreaterThan(before.updates);
				await editor.waitForRenderFlush();
				await editor.waitForRenderFlush();

				const after = await position(page, portSelector);
				if (change.keeps === 'end') {
					expect(after.maxScrollTop - after.scrollTop).toBeLessThan(END_SLACK);
				} else {
					expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(END_SLACK);
				}
			});
		}
	}
});

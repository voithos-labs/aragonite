import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { gotoReady } from '../../goto-ready';
import { attachIme } from '../../simulation/ime';
import { waitForAllImagesLoaded } from '../blocks/image/helpers';

// A composition started over a widget selected whole removes the widget first, and the composed
// run takes its place (requirements/selection/composition-over-widget.md).

const MODES = ['source', 'live'] as const;
type Mode = (typeof MODES)[number];

const IMAGE = '![x](/test-fixtures/sample.png)';
const CHIPS = 'Prose {{alpha}} here\n\n| Note | B |\n| --- | --- |\n| x {{beta}} y | z |\n';

/** The candidates shown while composing, then a converted commit. */
const UPDATES = ['か', 'かん'];
const COMMIT = '漢';

interface WidgetRow {
	name: string;
	source: string;
	/** The plugins harness page with this seed's plugin. */
	plugin?: 'chips';
	select: (editor: EditorPage, page: Page) => Promise<void>;
	/** The document once `text` stands where the widget was; '' is the removal alone. */
	after: (text: string, mode: Mode) => string;
}

async function clickPicture(editor: EditorPage, page: Page): Promise<void> {
	const box = await page.locator('[data-image-widget]').boundingBox();
	if (!box) throw new Error('the picture has no box');
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await editor.waitForRenderFlush();
}

const keyFrom =
	(path: number[], offset: number, key: string) =>
	async (editor: EditorPage, page: Page): Promise<void> => {
		await editor.focusBlockAtPath(path, offset);
		await page.keyboard.press(key);
		await editor.waitForRenderFlush();
	};

const ROWS: WidgetRow[] = [
	{
		name: 'a picture clicked, with text on both sides',
		source: `lead ${IMAGE} tail\n`,
		select: clickPicture,
		after: (text) => `lead ${text} tail\n`
	},
	{
		name: 'a picture reached by ArrowRight, from its start',
		source: `lead ${IMAGE} tail\n`,
		select: keyFrom([0], 'lead '.length, 'ArrowRight'),
		after: (text) => `lead ${text} tail\n`
	},
	{
		name: 'a picture alone in its block',
		source: `${IMAGE}\n`,
		select: clickPicture,
		after: (text) => `${text}\n`
	},
	{
		// Live mode drops the pair the removal emptied, so the run there is plain.
		name: 'a picture inside strong',
		source: `lead **${IMAGE}** tail\n`,
		select: clickPicture,
		after: (text, mode) => (mode === 'live' ? `lead ${text} tail\n` : `lead **${text}** tail\n`)
	},
	{
		name: 'a line break reached by ArrowRight',
		source: 'ab<br>cd\n',
		select: keyFrom([0], 2, 'ArrowRight'),
		after: (text) => `ab${text}cd\n`
	},
	{
		name: 'a plugin’s chip in a paragraph',
		source: CHIPS,
		plugin: 'chips',
		select: keyFrom([0], 15, 'ControlOrMeta+k'),
		after: (text) => CHIPS.replace('{{alpha}}', text)
	},
	{
		name: 'a plugin’s chip in a table cell',
		source: CHIPS,
		plugin: 'chips',
		select: keyFrom([1, 1, 0], 10, 'ControlOrMeta+k'),
		after: (text) => CHIPS.replace('{{beta}}', text)
	},
	{
		name: 'a plugin’s chip alone in a table cell',
		source: CHIPS.replace('x {{beta}} y', '{{beta}}'),
		plugin: 'chips',
		select: keyFrom([1, 1, 0], '{{beta}}'.length, 'ControlOrMeta+k'),
		after: (text) => CHIPS.replace('x {{beta}} y', text)
	}
];

async function open(editor: EditorPage, page: Page, mode: Mode, row: WidgetRow): Promise<void> {
	if (row.plugin) {
		await gotoReady(page, `/test/plugins?seed=${row.plugin}`);
		if (mode === 'live') await editor.setPresentationMode('live');
	} else {
		await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
	}
	await editor.loadContent(row.source);
	await waitForAllImagesLoaded(page);
}

/** The text from the start of the focused editable to the browser's caret. */
function textBeforeCaret(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const host = document.activeElement as HTMLElement | null;
		const sel = window.getSelection();
		if (!host?.isContentEditable || !sel?.focusNode || !host.contains(sel.focusNode)) return null;
		const range = document.createRange();
		range.setStart(host, 0);
		range.setEnd(sel.focusNode, sel.focusOffset);
		return range.toString();
	});
}

for (const mode of MODES) {
	test.describe(`IME composition over a widget selected whole (${mode})`, () => {
		for (const row of ROWS) {
			test(`${row.name}: the commit takes its place, and one undo restores it`, async ({
				page
			}) => {
				const editor = new EditorPage(page);
				await open(editor, page, mode, row);
				await row.select(editor, page);
				const ime = await attachIme(page);

				for (const update of UPDATES) {
					await ime.compose(update);
					// The widget goes as the composition starts; the composed run is on screen only.
					expect(await editor.bridge.getSource()).toBe(row.after('', mode));
				}
				await ime.commit(COMMIT);

				await expect.poll(() => editor.bridge.getSource()).toBe(row.after(COMMIT, mode));
				expect(await textBeforeCaret(page)).toMatch(new RegExp(`${COMMIT}$`));
				await editor.undo();
				await editor.bridge.waitForSourceEquals(row.source);
			});

			test(`${row.name}: an abandoned composition leaves it removed, and one undo restores it`, async ({
				page
			}) => {
				const editor = new EditorPage(page);
				await open(editor, page, mode, row);
				await row.select(editor, page);
				const ime = await attachIme(page);

				await ime.compose(UPDATES[0]);
				await ime.abort();

				await editor.waitForNoSourceMutation();
				expect(await editor.bridge.getSource()).toBe(row.after('', mode));
				await editor.undo();
				await editor.bridge.waitForSourceEquals(row.source);
			});
		}

		// The undo entry anchors where a typed key's does: the edge the widget was selected from.
		for (const row of ROWS.slice(0, 2)) {
			test(`${row.name}: undo lands the caret where a typed key’s undo does`, async ({ page }) => {
				const editor = new EditorPage(page);
				await open(editor, page, mode, row);
				await row.select(editor, page);
				await page.keyboard.type('Z');
				await editor.bridge.waitForSourceEquals(row.after('Z', mode));
				await editor.undo();
				await editor.bridge.waitForSourceEquals(row.source);
				const byKey = await editor.bridge.getSelection();

				await open(editor, page, mode, row);
				await row.select(editor, page);
				const ime = await attachIme(page);
				await ime.compose(UPDATES[0]);
				await ime.commit(COMMIT);
				await editor.bridge.waitForSourceEquals(row.after(COMMIT, mode));
				await editor.undo();
				await editor.bridge.waitForSourceEquals(row.source);
				expect(await editor.bridge.getSelection()).toEqual(byKey);
			});
		}
	});
}

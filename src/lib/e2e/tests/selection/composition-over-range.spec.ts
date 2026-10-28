import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { attachIme } from '../../simulation/ime';
import { edgeKey, extendKey } from '../../platform-keys';

// A composition started over a range across blocks removes the range first, then composes in the
// block the removal kept, wherever the browser's caret sat (requirements/selection/).

interface RangeRoute {
	name: string;
	source: string;
	/** Draws the range by keyboard, leaving the browser's caret where that gesture leaves it. */
	draw(editor: EditorPage): Promise<void>;
	/** The document once `text` is composed where the range was; '' is the removal alone. */
	after(text: string): string;
}

const THREE = 'alpha\n\nbeta\n\ngamma\n';
const LONG = Array.from({ length: 200 }, (_, i) => `para ${i}`).join('\n\n') + '\n';

/** Shift+Home, then one more step up or left: a range from the caret's block into the one before. */
async function drawIntoPrevious(editor: EditorPage, step: 'ArrowUp' | 'ArrowLeft'): Promise<void> {
	await editor.page.keyboard.press(extendKey('lineStart'));
	await editor.page.keyboard.press(`Shift+${step}`);
}

const ROUTES: RangeRoute[] = [
	{
		name: 'the whole document (Ctrl+A twice)',
		source: THREE,
		async draw(editor) {
			await editor.focusBlock(1, 2);
			await editor.selectAll();
			await editor.selectAll();
		},
		after: (text) => `${text}\n`
	},
	{
		name: 'first block to last, drawn upward',
		source: THREE,
		async draw(editor) {
			await editor.focusBlock(2, 2);
			await editor.page.keyboard.press(extendKey('docStart'));
		},
		after: (text) => `${text}mma\n`
	},
	{
		name: 'the last block alone, drawn upward',
		source: THREE,
		async draw(editor) {
			await editor.focusBlockEnd(2);
			await drawIntoPrevious(editor, 'ArrowLeft');
		},
		after: (text) => `alpha\n\nbeta${text}\n`
	},
	{
		name: 'first block to last, drawn downward',
		source: THREE,
		async draw(editor) {
			await editor.focusBlock(0, 2);
			await editor.page.keyboard.press(extendKey('docEnd'));
		},
		after: (text) => `al${text}\n`
	},
	{
		// The start block lies past windowing's reach once the end shows, so it unmounts.
		name: 'a long document drawn downward, its first block windowed out',
		source: LONG,
		async draw(editor) {
			await editor.focusBlock(0, 2);
			await editor.page.keyboard.press(extendKey('docEnd'));
			await expect(editor.page.locator('[data-block-path="0"]')).toHaveCount(0);
		},
		after: (text) => `pa${text}\n`
	},
	{
		name: 'both paragraphs of a quote',
		source: '> one\n>\n> two\n\nafter\n',
		async draw(editor) {
			await editor.focusBlockAtPath([0, 1], 3);
			await drawIntoPrevious(editor, 'ArrowUp');
		},
		after: (text) => (text ? `> ${text}\n\nafter\n` : '>\n\nafter\n')
	},
	{
		name: 'both items of a list',
		source: '- one\n- two\n\nafter\n',
		async draw(editor) {
			await editor.focusBlockAtPath([0, 1, 0], 3);
			await drawIntoPrevious(editor, 'ArrowUp');
		},
		after: (text) => `- ${text}\n\nafter\n`
	},
	{
		name: 'both cells of a table row',
		source: '| a | b |\n| - | - |\n| cc | dd |\n',
		async draw(editor) {
			await editor.page.locator('.table-cell').nth(2).click();
			await editor.page.keyboard.press(edgeKey('lineStart'));
			await editor.page.keyboard.press(extendKey('lineEnd'));
			await editor.page.keyboard.press('Shift+ArrowRight');
			await editor.page.keyboard.press('Shift+ArrowRight');
		},
		after: (text) => `| a | b |\n| - | - |\n| ${text} |  |\n`
	},
	{
		name: 'a code block’s body into the paragraph after it',
		source: '```\ncode\n```\n\nafter\n',
		async draw(editor) {
			await editor.focusBlock(0, '```\nco'.length);
			await editor.page.keyboard.press(extendKey('docEnd'));
		},
		after: (text) => `\`\`\`\nco${text}\n\`\`\`\n`
	}
];

/** The candidates shown while composing, then a converted commit. */
const UPDATES = ['か', 'かん'];
const COMMIT = '漢';

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

for (const mode of ['source', 'live'] as const) {
	test.describe(`IME composition over a range across blocks (${mode})`, () => {
		let editor: EditorPage;

		test.beforeEach(async ({ page }) => {
			editor = new EditorPage(page);
			await editor.goto(mode === 'live' ? '?presentationMode=live' : '');
		});

		for (const route of ROUTES) {
			test(`${route.name}: the commit lands once in the kept block, and one undo restores it`, async ({
				page
			}) => {
				await editor.loadContent(route.source);
				await route.draw(editor);
				await editor.waitForCrossBlock(true);
				const ime = await attachIme(page);

				for (const update of UPDATES) {
					await ime.compose(update);
					// The removal commits as the composition starts; the composed run stays on screen only.
					expect(await editor.bridge.getSource()).toBe(route.after(''));
				}
				await ime.commit(COMMIT);

				await expect.poll(() => editor.bridge.getSource()).toBe(route.after(COMMIT));
				expect(await textBeforeCaret(page)).toMatch(new RegExp(`${COMMIT}$`));
				await editor.undo();
				await editor.bridge.waitForSourceEquals(route.source);
			});

			test(`${route.name}: an abandoned composition leaves the removal alone`, async ({ page }) => {
				await editor.loadContent(route.source);
				await route.draw(editor);
				await editor.waitForCrossBlock(true);
				const ime = await attachIme(page);

				await ime.compose(UPDATES[0]);
				await ime.abort();

				await editor.waitForNoSourceMutation();
				expect(await editor.bridge.getSource()).toBe(route.after(''));
			});
		}
	});
}

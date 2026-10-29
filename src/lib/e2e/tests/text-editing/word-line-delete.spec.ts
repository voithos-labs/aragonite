import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { isMacOS, WORD_MODIFIER } from '../../platform-keys';

/**
 * A word or line delete at a caret takes what the editor names, the same bytes on every engine
 * (`requirements/text-editing/word-line-delete.md`).
 */

const escaped = (source: string) => JSON.stringify(source);

async function expectSource(editor: EditorPage, expected: string): Promise<void> {
	await expect.poll(async () => escaped(await editor.bridge.getSource())).toBe(escaped(expected));
}

/** A delete with no key in front of it, as a soft keyboard or an OS shortcut layer sends it. */
async function sendKeylessDelete(page: Page, inputType: string): Promise<void> {
	await page.evaluate((inputType) => {
		document.activeElement!.dispatchEvent(
			new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true })
		);
	}, inputType);
}

test.describe('a word delete by key', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Backspace takes the word before the caret and the spaces after it', async ({ page }) => {
		await editor.loadContent('foo bar  \n');
		await editor.focusBlockAtPath([0], 9);
		await page.keyboard.press(`${WORD_MODIFIER}+Backspace`);
		await expectSource(editor, 'foo \n');
		await editor.undo();
		await expectSource(editor, 'foo bar  \n');
	});

	// Apple's Option+Delete keeps the space after the word; everyone else's takes it.
	test('Delete takes the word after the caret, to the platform’s stop', async ({ page }) => {
		await editor.loadContent('foo bar\n');
		await editor.focusBlockAtPath([0], 0);
		await page.keyboard.press(`${WORD_MODIFIER}+Delete`);
		await expectSource(editor, isMacOS ? ' bar\n' : 'bar\n');
	});

	test('a code block takes the word before the caret', async ({ page }) => {
		await editor.loadContent('```\nlet value\n```\n');
		await editor.focusBlockAtPath([0], 13);
		await page.keyboard.press(`${WORD_MODIFIER}+Backspace`);
		await expectSource(editor, '```\nlet \n```\n');
	});

	// Firefox's and WebKit's segmenters join `foo.bar`, Chromium's cuts it.
	test('a full stop between letters ends a word, in prose and code', async ({ page }) => {
		const code = '```\nfoo.bar baz\n```\n';
		await editor.loadContent(`foo.bar, baz\n\n${code}`);
		await editor.focusBlockAtPath([0], 0);
		await page.keyboard.press(`${WORD_MODIFIER}+Delete`);
		await expectSource(editor, `.bar, baz\n\n${code}`);
		await editor.focusBlockAtPath([1], 12);
		await page.keyboard.press(`${WORD_MODIFIER}+Backspace`);
		await expectSource(editor, `.bar, baz\n\n${code.replace('foo.bar baz', 'foo.baz')}`);
	});

	test('an entity before the caret goes whole, as Backspace takes it', async ({ page }) => {
		await editor.loadContent('a &copy;\n');
		await editor.focusBlockAtPath([0], 8);
		await page.keyboard.press(`${WORD_MODIFIER}+Backspace`);
		await expectSource(editor, 'a \n');
	});
});

// In live mode a word is read as the screen shows it, so the bytes match a selection of that same
// text deleted, which the range route writes through the join that keeps every kept mark.
const LIVE_ROWS = [
	{ name: 'a word inside a bold run', source: '**one two three** x\n', at: 9, chars: 3 },
	{ name: 'a word ending at a hidden closer', source: 'a **bold** c\n', at: 10, chars: 4 },
	{ name: 'a word beside an entity', source: 'a &copy;word c\n', at: 12, chars: 4 },
	// Forward, the word and, but on a Mac, the space after it.
	{
		name: 'a word after a hidden opener, forward',
		source: '**bold** x\n',
		at: 0,
		chars: isMacOS ? 4 : 5,
		forward: true
	}
];

test.describe('in live mode, a word delete matches the same text selected and deleted', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.setPresentationMode('live');
	});

	for (const row of LIVE_ROWS) {
		test(row.name, async ({ page }) => {
			await editor.loadContent(row.source);
			await editor.focusBlockAtPath([0], row.at);
			const extend = row.forward ? 'Shift+ArrowRight' : 'Shift+ArrowLeft';
			for (let i = 0; i < row.chars; i++) await page.keyboard.press(extend);
			await page.keyboard.press('Delete');
			await editor.waitForRenderFlush();
			const selected = await editor.bridge.getSource();
			expect(selected).not.toBe(row.source);

			await editor.loadContent(row.source);
			await editor.focusBlockAtPath([0], row.at);
			await page.keyboard.press(`${WORD_MODIFIER}+${row.forward ? 'Delete' : 'Backspace'}`);
			await expectSource(editor, selected);
		});
	}
});

test.describe('a line delete', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('to the line start takes the visual line before the caret', async ({ page }) => {
		await editor.loadContent('first\n\nabc def\n');
		await editor.focusBlockAtPath([1], 7);
		await sendKeylessDelete(page, 'deleteSoftLineBackward');
		await expectSource(editor, 'first\n\n\n');
	});

	test('to the line end takes the code line after the caret, not the next', async ({ page }) => {
		await editor.loadContent('```\nab\ncd\n```\n');
		await editor.focusBlockAtPath([0], 4);
		await sendKeylessDelete(page, 'deleteHardLineForward');
		await expectSource(editor, '```\n\ncd\n```\n');
	});

	test('a wrapped paragraph loses only its last visual line', async ({ page }) => {
		const text = 'word '.repeat(60).trim();
		await editor.loadContent(`${text}\n`);
		await editor.focusBlockAtPath([0], text.length);
		await sendKeylessDelete(page, 'deleteSoftLineBackward');
		await editor.waitForRenderFlush();
		const left = (await editor.bridge.getSource()).trimEnd();
		expect(left.length).toBeGreaterThan(0);
		expect(left.length).toBeLessThan(text.length);
		expect(text.startsWith(left)).toBe(true);
	});
});

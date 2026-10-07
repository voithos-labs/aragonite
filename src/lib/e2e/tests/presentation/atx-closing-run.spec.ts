import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import type { EditorPage } from '../../editor-page';
import { enterPresentationMode, nextRow } from './helpers';

// An ATX heading's closing `#` run is a marker after the text, and keys at the text's end keep it
// there. Each test walks its rows as steps, every step on a fresh copy of its document.
// Requirements: e2e/requirements/presentation/atx-closing-run.md.

const DOC = '# Hi #\n\nnext\n';

// The caret starts the new line when it sits just past the pending break's first anchor.
async function caretStartsNewLine(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const sel = window.getSelection();
		const node = sel?.focusNode;
		if (!sel || !node) return false;
		const before =
			node.nodeType === Node.ELEMENT_NODE
				? node.childNodes[sel.focusOffset - 1]
				: sel.focusOffset === 0
					? node.previousSibling
					: null;
		return before instanceof HTMLBRElement && before.dataset.caretAnchor === 'break';
	});
}

test.describe('the closing run on screen', () => {
	test('source mode shows it after the text', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('# Hi #');
	});

	test('live mode hides it', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		expect(await ep.getBlock(0).innerText()).toBe('Hi');
	});
});

test('live mode: keys at the end of the text', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('a typed key lands before the closing run', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals('# Hix #\n\nnext\n');
	});

	await test.step('Backspace takes the last character and keeps the run', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceEquals('# H #\n\nnext\n');
	});

	await test.step('a typed space stays text, and the next key follows it', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly(' ');
		await ep.bridge.waitForSourceEquals('# Hi  #\n\nnext\n');
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals('# Hi x #\n\nnext\n');
	});

	await test.step('a typed closing run turns back into text with the next key', async () => {
		await nextRow(ep, '# Hi\n\nnext\n');
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await ep.typeSlowly(' #');
		await ep.bridge.waitForSourceEquals('# Hi #\n\nnext\n');
		await ep.typeSlowly('t');
		await ep.bridge.waitForSourceEquals('# Hi #t\n\nnext\n');
	});
});

// The same gesture on the three heading shapes: the structure past the text goes with the text.
test('live mode: emptying the text', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	await test.step('inside a list item, Backspace over the last character, then a key, writes the key as the heading text', async () => {
		await nextRow(ep, '- # H #\n- b\n');
		await ep.focusBlockAtPath([0, 0, 0], 1);
		await page.keyboard.press('End');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceEquals('- #  #\n- b\n');
		await ep.typeSlowly('k');
		await ep.bridge.waitForSourceEquals('- # k #\n- b\n');
	});

	// Focused and empty, the heading paints both markers, so End goes past the run as in source.
	await test.step('End in an empty heading with a closing run, then a key, writes past the run', async () => {
		await nextRow(ep, '#  #\n\nnext\n');
		await ep.focusBlockAtPath([0], 0);
		await page.keyboard.press('End');
		await ep.typeSlowly('k');
		await ep.bridge.waitForSourceEquals('#  #k\n\nnext\n');
	});

	await test.step('selecting the text and typing a space leaves a paragraph holding the space', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Home');
		await ep.typeSlowly(' ');
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals(' x\n\nnext\n');
	});

	for (const source of ['# H\n\nnext\n', '# H #\n\nnext\n', 'H\n===\n\nnext\n']) {
		await test.step(`Backspace over the last character of ${JSON.stringify(source)} leaves an empty paragraph`, async () => {
			await nextRow(ep, source);
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await page.keyboard.press('Backspace');
			await ep.bridge.waitForSourceEquals('\nnext\n');
			await ep.typeSlowly('k');
			await ep.bridge.waitForSourceEquals('k\n\nnext\n');
		});
	}

	await test.step('selecting the text and pressing Backspace leaves an empty paragraph', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 3);
		await page.keyboard.press('End');
		await page.keyboard.press('Shift+Home');
		await page.keyboard.press('Backspace');
		await ep.bridge.waitForSourceEquals('\nnext\n');
		await ep.typeSlowly('k');
		await ep.bridge.waitForSourceEquals('k\n\nnext\n');
	});
});

// Where the run is on screen, an edit takes it only when the selection did.
async function selectPrefixAndBackspace(ep: EditorPage, page: Page): Promise<void> {
	await ep.focusBlockAtPath([0], 0);
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Shift+ArrowRight');
	await page.keyboard.press('Backspace');
	await ep.bridge.waitForSourceEquals('Hi #\n\nnext\n');
}

test.describe('shown closing run: a selection that leaves it keeps it', () => {
	test('source mode', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);

		for (const [source, path, written] of [
			[DOC, [0], 'x #\n\nnext\n'],
			['- # Hi #\n- b\n', [0, 0, 0], '- x #\n- b\n']
		] as const) {
			await test.step(`selecting "# Hi" of ${JSON.stringify(source)} and typing x keeps the run`, async () => {
				await nextRow(ep, source);
				await ep.focusBlockAtPath([...path], 4);
				await page.keyboard.press('Shift+Home');
				await ep.typeSlowly('x');
				await ep.bridge.waitForSourceEquals(written);
			});
		}

		await test.step('selecting the "# " and pressing Backspace keeps the run', async () => {
			await nextRow(ep, DOC);
			await selectPrefixAndBackspace(ep, page);
		});
	});

	for (const mode of ['preview-block', 'preview-inline'] as const) {
		test(`${mode}: selecting the "# " and pressing Backspace keeps the run`, async ({ page }) => {
			const ep = await enterPresentationMode(page, mode, DOC);
			await selectPrefixAndBackspace(ep, page);
		});
	}
});

test('live mode: the closing run stays on the heading', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'live', DOC);

	for (const [source, written] of [
		['# Hi\n\nnext\n', '# H\\\nwi\n\nnext\n'],
		['# Hi #\n\nnext\n', '# H\\ #\nwi\n\nnext\n']
	]) {
		await test.step(`Shift+Enter inside the text of ${JSON.stringify(source)}, then a key`, async () => {
			await nextRow(ep, source);
			await ep.focusBlockAtPath([0], 3);
			await page.keyboard.press('Shift+Enter');
			await ep.typeSlowly('w');
			await ep.bridge.waitForSourceEquals(written);
		});
	}

	for (const [source, written] of [
		['# Hi\n\nnext\n', '# Hi\\\nw\n\nnext\n'],
		['# Hi #\n\nnext\n', '# Hi\\ #\nw\n\nnext\n'],
		['Hi\n===\n\nnext\n', 'Hi\\\nw\n===\n\nnext\n'],
		['Hi\n\nnext\n', 'Hi\\\nw\n\nnext\n']
	]) {
		await test.step(`Shift+Enter at the end of the text of ${JSON.stringify(source)}, then a key`, async () => {
			await nextRow(ep, source);
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await page.keyboard.press('Shift+Enter');
			await expect.poll(() => caretStartsNewLine(page)).toBe(true);
			await ep.typeSlowly('w');
			await ep.bridge.waitForSourceEquals(written);
		});
	}

	for (const [source, written] of [
		['# Hi\n\nnext\n', '# Hi\n\nabc\n\ndef\n\nnext\n'],
		['# Hi #\n\nnext\n', '# Hi #\n\nabc\n\ndef\n\nnext\n'],
		['Hi\n===\n\nnext\n', 'Hi\n===\n\nabc\n\ndef\n\nnext\n']
	]) {
		await test.step(`pasting two paragraphs at the end of ${JSON.stringify(source)}`, async () => {
			await nextRow(ep, source);
			await ep.seedClipboard('abc\n\ndef');
			await ep.focusBlockAtPath([0], 1);
			await page.keyboard.press('End');
			await ep.paste();
			await ep.bridge.waitForSourceEquals(written);
		});
	}
});

test('preview-block: the closing run stays on the heading', async ({ page }) => {
	const ep = await enterPresentationMode(page, 'preview-block', DOC);

	await test.step('Shift+Enter at the end of the text shows the run on the heading line, and a key starts the new line', async () => {
		await nextRow(ep, DOC);
		await ep.focusBlockAtPath([0], 4);
		await page.keyboard.press('Shift+Enter');
		await expect.poll(() => caretStartsNewLine(page)).toBe(true);
		expect((await ep.getBlock(0).innerText()).split('\n')[0]).toBe('# Hi #');
		expect(await ep.bridge.getSource()).toBe('# Hi #\n\nnext\n');
		await ep.typeSlowly('w');
		await ep.bridge.waitForSourceEquals('# Hi\\ #\nw\n\nnext\n');
	});

	await test.step("a key between the shown run's space and its # lands there", async () => {
		await nextRow(ep, '# Hi\\ #\n\nnext\n');
		await ep.focusBlockAtPath([0], 6);
		await ep.typeSlowly('x');
		await ep.bridge.waitForSourceEquals('# Hi\\ x#\n\nnext\n');
	});
});

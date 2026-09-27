import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { PluginsPage } from '../plugins/helpers';
import { textRunCenter, textRunStart } from '../../text-runs';
import { findInput, openReplace, replaceInput, typeQuery } from '../search/helpers';

// Each gesture that takes several commits: one Ctrl+Z back to the exact bytes and selection from
// before it, one Ctrl+Shift+Z forward to the exact bytes and selection after it.

type State = { src: string; sel: unknown; depth: number };

async function read(editor: EditorPage): Promise<State> {
	await editor.waitForRenderFlush();
	return {
		src: await editor.bridge.getSource(),
		sel: await editor.bridge.getSelection(),
		depth: await editor.bridge.getUndoDepth()
	};
}

interface RoundTripOptions {
	/** Runs between the gesture and Ctrl+Z, for a gesture that leaves focus outside the document. */
	beforeUndo?: () => Promise<void>;
	/** Off where the selection before the gesture was outside the document, so undo restores
	 *  the entry's fallback caret instead. */
	selection?: boolean;
}

async function roundTrip(
	editor: EditorPage,
	gesture: () => Promise<void>,
	{ beforeUndo, selection = true }: RoundTripOptions = {}
): Promise<void> {
	const before = await read(editor);
	await gesture();
	await editor.bridge.waitForSource((s) => s !== before.src);
	// The gesture's later commits and its caret landing run after the first byte moves.
	await editor.waitForNoSourceMutation();
	const after = await read(editor);
	expect(after.depth, 'one entry per gesture').toBe(before.depth + 1);

	if (beforeUndo) await beforeUndo();
	await editor.undo();
	await editor.bridge.waitForSourceEquals(before.src);
	const undone = await read(editor);
	expect(undone.depth).toBe(before.depth);
	if (selection) expect(undone.sel, 'selection after Ctrl+Z').toEqual(before.sel);

	await editor.redo();
	await editor.bridge.waitForSourceEquals(after.src);
	const redone = await read(editor);
	expect(redone.depth).toBe(after.depth);
	if (selection) expect(redone.sel, 'selection after Ctrl+Shift+Z').toEqual(after.sel);
}

test.describe('undo steps: one gesture, one round trip', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectAcrossThreeBlocks(page: Page): Promise<void> {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockAtPath([0], 2);
		await page.keyboard.press('Shift+ArrowDown');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
	}

	test('paste over a range', async ({ page }) => {
		await selectAcrossThreeBlocks(page);
		await editor.seedClipboard('One\n\nTwo');
		await roundTrip(editor, () => editor.paste());
	});

	test('typing over a range', async ({ page }) => {
		await selectAcrossThreeBlocks(page);
		await roundTrip(editor, () => page.keyboard.type('X'));
	});

	test('Enter over a range', async ({ page }) => {
		await selectAcrossThreeBlocks(page);
		await roundTrip(editor, () => page.keyboard.press('Enter'));
	});

	test('Mod+2 over a range', async ({ page }) => {
		await selectAcrossThreeBlocks(page);
		await roundTrip(editor, () => page.keyboard.press('ControlOrMeta+2'));
	});

	test('a word dropped into another paragraph', async ({ page }) => {
		await editor.loadContent('alpha beta gamma\n\nsecond para here\n');
		const at = await textRunCenter(page, 'beta');
		await page.mouse.dblclick(at.x, at.y);
		const to = await textRunStart(page, 'second para here');
		await roundTrip(editor, async () => {
			await page.mouse.move(at.x, at.y);
			await page.mouse.down();
			await page.mouse.move(at.x + 4, at.y, { steps: 2 });
			await page.mouse.move(to.x, to.y, { steps: 12 });
			await page.mouse.move(to.x + 1, to.y, { steps: 2 });
			await page.mouse.up();
		});
	});

	test('replace-all', async ({ page }) => {
		await editor.loadContent('foo one\n\nfoo two\n\nfoo three\n');
		await openReplace(editor);
		await findInput(page).click();
		await typeQuery(editor, 'foo');
		await replaceInput(page).fill('bar');
		await roundTrip(editor, () => page.getByRole('button', { name: 'All', exact: true }).click(), {
			// The button holds focus after the click, and Ctrl+Z is the document's chord.
			beforeUndo: () => editor.clickBlock(2),
			selection: false
		});
	});

	// Miss-analysis: the typing suites counted entries only around a split, never mid-burst.
	test('a keystroke that reparses its block, mid-typing', async ({ page }) => {
		await editor.loadContent('alpha\n\nTitle\n');
		await editor.focusBlockAtPath([1], 0);
		await roundTrip(editor, () => page.keyboard.type('# '));
	});
});

test.describe('undo steps: an inline-menu pick', () => {
	test('a slash command after text', async ({ page }) => {
		const editor = new PluginsPage(page);
		await editor.gotoPlugins('inline-menu');
		await editor.focusBlockEnd(2);
		await editor.typeText(' /quote');
		const menu = page.locator('[data-inline-menu="slash-commands"]');
		await expect
			.poll(() => menu.locator('[role="option"] .inline-menu-label').allTextContents())
			.toEqual(['Quote']);
		await editor.waitForUndoBatchFlush();
		await roundTrip(editor, async () => {
			await page.keyboard.press('Enter');
			await expect.poll(() => editor.bridge.getBlockKind(3)).toBe('blockquote');
		});
	});
});

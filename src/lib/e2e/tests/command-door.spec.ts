import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import { nextRow } from './presentation/helpers';
import type { KeybindingOverride } from '../../schema/keybinding-overrides';

// editor.runCommand(): the public call a selection toolbar makes
// (`requirements/command-door.md`). Selections are built with real gestures; the call itself is
// programmatic, because that call is exactly what a toolbar button holds.

const FORMAT_IDS = [
	'format.toggleStrong',
	'format.toggleEmphasis',
	'format.toggleStrikethrough',
	'format.toggleCode'
];

test.describe('runCommand: the semantic command entry point', () => {
	let editor: EditorPage;

	const run = (commandId: string): Promise<boolean> =>
		editor.page.evaluate((id) => (window as any).__test.runCommand(id) as boolean, commandId);

	const setKeybindings = (overrides: KeybindingOverride[] | undefined): Promise<void> =>
		editor.page.evaluate((ov) => (window as any).__test.setKeybindings(ov), overrides);

	/** Select `world` in `Hello world` the way a user does: click in, then extend by key. */
	async function selectWorld(): Promise<void> {
		await editor.focusBlock(0, 'Hello '.length);
		for (let i = 0; i < 'world'.length; i++) {
			await editor.page.keyboard.press('Shift+ArrowRight');
		}
	}

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('the entry point and the chord write the same bytes over the same selection', async () => {
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await selectWorld();
		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('**world**');
		const viaDoor = await editor.bridge.getSource();

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		await selectWorld();
		await editor.page.keyboard.press('ControlOrMeta+b');
		await editor.bridge.waitForSourceContains('**world**');
		expect(await editor.bridge.getSource()).toBe(viaDoor);
	});

	// The whole reason `runCommand` exists: rebinding moves the keys, never the button.
	test('a rebound chord leaves the entry point untouched, and both still reach the branch', async () => {
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await setKeybindings([{ chord: 'Mod+Alt+G', command: 'format.toggleStrong' }]);
		await selectWorld();

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('Hello **world**');

		await editor.undo();
		await editor.bridge.waitForSourceEquals(before);
		await selectWorld();
		await editor.page.keyboard.press('ControlOrMeta+Alt+g');
		await editor.bridge.waitForSourceContains('Hello **world**');
	});

	test('the toggled range stays selected, so a second call strips the pair', async () => {
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await selectWorld();

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('Hello **world**');

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceEquals(before);
	});

	// Live mode shows no delimiters, so a collapsed caret pends the mark instead of writing an
	// invisible pair, and the link card exists in live mode alone.
	test('in live mode a collapsed caret pends the mark, and the link-edit id opens the card', async () => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlock(0, 'Hello '.length);

		await test.step('a collapsed caret pends the mark instead of writing a pair', async () => {
			expect(await run('format.toggleStrong')).toBe(true);
			// The `runCommand` call, with no keystroke behind it.
			await editor.waitForNoSourceMutation();
			expect(await editor.bridge.getSource()).toBe(before);

			await editor.page.keyboard.type('X');
			await editor.bridge.waitForSourceContains('**X**');
		});

		await test.step('the link-edit id opens the card Mod+K opens', async () => {
			await nextRow(editor, 'Hello world\n');
			await selectWorld();

			expect(await run('link.openCard')).toBe(true);
			await expect(editor.page.locator('[data-link-card]')).toBeVisible();
		});
	});

	test('a table cell takes the entry point through its published ref slot', async () => {
		await editor.loadContent('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		await editor.page.locator('.table-cell').nth(3).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+ArrowRight');

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('| **2** |');
	});

	// The keyboard shortcut never reaches here, since the cross-block keydown handler takes it, so
	// only a call by command id reaches that handler instead of a single-block one.
	test('a cross-block range routes the toggle to the branch, in one undo entry', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlock(0, 'alp'.length);
		await editor.shiftClickBlock([1], 'be'.length);
		await editor.waitForCrossBlock(true);

		expect(await run('format.toggleStrong')).toBe(true);
		// Each endpoint's own span: the anchor block's tail, the focus block's head.
		await editor.bridge.waitForSourceEquals('alp**ha**\n\n**be**ta\n', 3000);

		// One entry for the whole range, not one per block.
		await editor.undo();
		await editor.bridge.waitForSourceEquals(before, 3000);
	});

	// A caret in a gap focuses a hidden host, not a block, so every block-local command declines.
	// Nested, since a gap at the root resolves to no path anyway.
	test('a gap caret declines every block-local id and keeps the gap', async () => {
		const quotedFence = 'para\n\n> quoted\n>\n> ```\n> code\n> ```\n';
		const atQuoteEnd = { parentPath: [1], index: 2 };
		await editor.loadContent(quotedFence);
		await editor.focusBlockAtPath([1, 1], 'code'.length + '```\n'.length);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(atQuoteEnd);

		for (const commandId of FORMAT_IDS) expect(await run(commandId)).toBe(false);

		// The `runCommand` call, with no keystroke behind it.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(quotedFence);
		expect(await editor.bridge.getGapCaret()).toEqual(atQuoteEnd);
	});
});

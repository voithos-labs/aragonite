import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import type { KeybindingOverride } from '../../schema/keybinding-overrides';

// editor.runCommand(): the public call a selection toolbar makes
// (`requirements/command-door.md`). Selections are built with real gestures; the call itself is
// programmatic, because that call is exactly what a toolbar button holds.

const TOGGLES = [
	['format.toggleStrong', 'Hello **world**'],
	['format.toggleEmphasis', 'Hello *world*'],
	['format.toggleStrikethrough', 'Hello ~~world~~'],
	['format.toggleCode', 'Hello `world`']
] as const;

test.describe('runCommand — the semantic command door', () => {
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

	for (const [commandId, expected] of TOGGLES) {
		test(`${commandId} wraps the selected word, and one undo restores it`, async () => {
			await editor.loadContent('Hello world\n');
			const before = await editor.bridge.getSource();
			await selectWorld();

			expect(await run(commandId)).toBe(true);
			await editor.bridge.waitForSourceContains(expected);

			await editor.undo();
			await editor.bridge.waitForSourceEquals(before);
		});
	}

	test('the door and the chord write the same bytes over the same selection', async () => {
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
	test('a rebound chord leaves the door untouched, and both still reach the arm', async () => {
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

	// The card belongs to live mode alone; every other mode already shows the destination bytes.
	test('the link-edit id opens the card Mod+K opens', async () => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('Hello world\n');
		await selectWorld();

		expect(await run('link.openCard')).toBe(true);
		await expect(editor.page.locator('[data-link-card]')).toBeVisible();
	});

	test('a collapsed caret takes the toggle: the pair lands where the caret stood', async () => {
		await editor.loadContent('Hello world\n');
		await editor.focusBlock(0, 'Hello '.length);

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('Hello ****world');
	});

	// Live mode shows no delimiters, so an empty pair would be invisible clutter: the mark waits
	// and the next typed text uses it (live-mode.md § 4.3). Either way the command reports that
	// it handled the click, since a toolbar button must not be told the click missed.
	test('a collapsed caret in live mode pends the mark instead of writing a pair', async () => {
		await editor.goto('?presentationMode=live');
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await editor.focusBlock(0, 'Hello '.length);

		expect(await run('format.toggleStrong')).toBe(true);
		// The `runCommand` call, with no keystroke behind it.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);

		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('**X**');
	});

	test('a table cell takes the door through its published ref slot', async () => {
		await editor.loadContent('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
		await editor.page.locator('[role="cell"]').nth(3).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Shift+ArrowRight');

		expect(await run('format.toggleStrong')).toBe(true);
		await editor.bridge.waitForSourceContains('| **2** |');
	});

	// The `runCommand` half of #127: the shortcut never reaches here, since the cross-block
	// keydown handler takes it, so only a call by command id reaches that handler rather than a
	// single-block one that would use the focused block's own offsets.
	test('a cross-block range routes the toggle to the arm, in one undo entry', async () => {
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

	test('the link editor is the one range command the door still declines', async () => {
		await editor.loadContent('alpha\n\nbeta\n');
		const before = await editor.bridge.getSource();

		await editor.focusBlock(0, 'alp'.length);
		await editor.shiftClickBlock([1], 'be'.length);
		await editor.waitForCrossBlock(true);

		expect(await run('link.openCard')).toBe(false);
		// The `runCommand` call, with no keystroke behind it.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});

	// The third selection mode: a caret in a gap focuses a hidden host, not a block, so the call
	// finds no editable element and every block-local command declines. Nested on purpose: a gap
	// at the root resolves to no path anyway, and only this one sits inside a container the
	// lookup would find.
	test('a gap caret declines every block-local id and keeps the gap', async () => {
		const quotedFence = 'para\n\n> quoted\n>\n> ```\n> code\n> ```\n';
		const atQuoteEnd = { parentPath: [1], index: 2 };
		await editor.loadContent(quotedFence);
		await editor.focusBlockAtPath([1, 1], 'code'.length + '```\n'.length);
		await editor.page.keyboard.press('Delete');
		await editor.bridge.waitForGapCaret(atQuoteEnd);

		for (const [commandId] of TOGGLES) expect(await run(commandId)).toBe(false);

		// The `runCommand` call, with no keystroke behind it.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(quotedFence);
		expect(await editor.bridge.getGapCaret()).toEqual(atQuoteEnd);
	});

	// A key that does nothing quietly looks the same as one that worked, so what the dispatch
	// reports is the other half of this check.
	test.describe('an unknown id', () => {
		test.use({ expectWarns: ['commands'] });

		test('declines and mutates nothing', async () => {
			await editor.loadContent('Hello world\n');
			const before = await editor.bridge.getSource();
			await selectWorld();

			expect(await run('format.toggleRainbow')).toBe(false);
			// The `runCommand` call, with no keystroke behind it.
			await editor.waitForNoSourceMutation();
			expect(await editor.bridge.getSource()).toBe(before);
		});
	});

	test('reading mode declines every published id', async () => {
		await editor.goto('?presentationMode=reading');
		await editor.loadContent('Hello world\n');
		const before = await editor.bridge.getSource();
		await editor.page.locator('.text-editable-block').first().click();

		for (const [commandId] of TOGGLES) expect(await run(commandId)).toBe(false);
		expect(await run('link.openCard')).toBe(false);

		// The `runCommand` call, with no keystroke behind it.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);
	});
});

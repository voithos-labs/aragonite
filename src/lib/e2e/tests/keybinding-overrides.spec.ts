import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';
import type { KeybindingOverride } from '../../schema/keybinding-overrides';

async function setKeybindings(editor: EditorPage, overrides: KeybindingOverride[] | undefined) {
	await editor.page.evaluate((ov) => (window as any).__test.setKeybindings(ov), overrides);
}

test.describe('keybinding-override prop', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('rebind: Mod+Y mapped to undo undoes the last edit', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Mod+Y', command: 'history.undo' }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type(' world');
		await expect.poll(() => editor.bridge.getSource()).toContain('hello world');
		await editor.page.keyboard.press('ControlOrMeta+y');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('world');
	});

	test('disable: Mod+Z no longer undoes; clearing the prop restores it', async () => {
		await editor.loadContent('hello\n');
		await setKeybindings(editor, [{ chord: 'Mod+Z', command: null }]);
		await editor.page.locator('.text-editable-block').first().click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('X');
		await editor.page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => editor.bridge.getSource()).toContain('helloX');

		// Clearing the prop brings the built-in undo back, so overrides never changed the keymap.
		await setKeybindings(editor, undefined);
		await editor.page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('helloX');
	});

	// Dropping the entry quietly would leave an author guessing why their shortcut does
	// nothing, so what the parser reports is part of what this case checks.
	test.describe('a malformed chord', () => {
		test.use({ expectWarns: ['keybindings'] });

		test('(Ctrl+B) is dropped and does not bind bare B', async () => {
			await editor.loadContent('hello\n');
			await setKeybindings(editor, [{ chord: 'Ctrl+B', command: 'history.undo' }]);
			await editor.page.locator('.text-editable-block').first().click();
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.type('b'); // would trigger the misbound undo if 'B' were bound
			await expect.poll(() => editor.bridge.getSource()).toContain('hellob');
		});
	});

	// An override scoped to one block kind, resolved by `resolveBinding`. Mod+Alt+Y has no
	// binding of its own, so it fires only where the heading's override exists.
	test('per-kind scope: a heading override does not fire in a paragraph', async () => {
		await editor.loadContent('# title\n\npara\n');
		await setKeybindings(editor, [
			{ chord: 'Mod+Alt+Y', command: 'history.undo', kind: 'heading' }
		]);

		const heading = editor.page.locator('.text-editable-block', { hasText: 'title' });
		await heading.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toContain('titleZ');
		await editor.page.keyboard.press('ControlOrMeta+Alt+y');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('titleZ');

		const para = editor.page.locator('.text-editable-block', { hasText: 'para' });
		await para.click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toContain('paraZ');
		await editor.page.keyboard.press('ControlOrMeta+Alt+y'); // unbound here, so no undo
		await editor.bridge.waitForSourceContains('paraZ');
		expect(await editor.bridge.getSource()).toContain('paraZ');
	});

	// The key travels up to the container: the list item's paragraph declines Tab, so it reaches
	// ListItemBlock.resolveKindBinding. An override scoped to that kind unbinds it.
	test('per-kind scope: disabling Tab on listItem stops the indent', async () => {
		await editor.loadContent('- one\n- two\n');
		await setKeybindings(editor, [{ chord: 'Tab', command: null, kind: 'listItem' }]);

		await editor.page.locator('.text-editable-block', { hasText: 'two' }).click();
		await editor.page.keyboard.press('Home');
		await editor.pressDeclined('Tab');

		expect(await editor.bridge.getSource()).not.toMatch(/- one\n {2}- two/);
		expect(await editor.bridge.getSource()).toContain('- two');
	});

	// An override with no kind reaches the container too: resolveKindBinding consults it, so
	// disabling Tab everywhere stops the list indenting.
	test('global scope: disabling Tab stops the list indent at the bubble', async () => {
		await editor.loadContent('- one\n- two\n');
		await setKeybindings(editor, [{ chord: 'Tab', command: null }]);

		await editor.page.locator('.text-editable-block', { hasText: 'two' }).click();
		await editor.page.keyboard.press('Home');
		await editor.pressDeclined('Tab');

		expect(await editor.bridge.getSource()).not.toMatch(/- one\n {2}- two/);
		expect(await editor.bridge.getSource()).toContain('- two');
	});
});

// Over a selection spanning blocks, a command key removes the selection and then runs at the caret
// that's left, so the selection goes only for a key the keymap binds to such a command.
test.describe('a command key over a selection spanning blocks', () => {
	let editor: EditorPage;

	async function selectAcross(overrides: KeybindingOverride[]): Promise<void> {
		await editor.loadContent('alpha\n\nbeta\n');
		await setKeybindings(editor, overrides);
		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);
	}

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const [chord, key] of [
		['Mod+2', 'ControlOrMeta+2'],
		['Enter', 'Enter']
	] as const) {
		test(`${chord} disabled removes nothing and the selection stays`, async () => {
			await selectAcross([{ chord, command: null }]);

			await editor.pressDeclined(key);

			expect(await editor.bridge.getSource()).toBe('alpha\n\nbeta\n');
			expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		});
	}

	for (const [chord, key] of [
		['Mod+2', 'ControlOrMeta+2'],
		['Enter', 'Enter']
	] as const) {
		test(`${chord} disabled on paragraphs removes nothing and the selection stays`, async () => {
			await selectAcross([{ chord, command: null, kind: 'paragraph' }]);

			await editor.pressDeclined(key);

			expect(await editor.bridge.getSource()).toBe('alpha\n\nbeta\n');
			expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		});
	}

	test('Enter disabled on paragraphs does nothing from a heading the selection ends in', async () => {
		await editor.loadContent('alpha\n\n# beta\n');
		await setKeybindings(editor, [{ chord: 'Enter', command: null, kind: 'paragraph' }]);
		await editor.focusBlockAtPath([0], 2);
		await editor.shiftClickBlock([1], 4);
		await editor.waitForCrossBlock(true);

		await editor.pressDeclined('Enter');

		expect(await editor.bridge.getSource()).toBe('alpha\n\n# beta\n');
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('a split bound to Mod+J on headings does nothing over paragraphs', async () => {
		await selectAcross([{ chord: 'Mod+J', command: 'block.split', kind: 'heading' }]);

		await editor.pressDeclined('ControlOrMeta+j');

		expect(await editor.bridge.getSource()).toBe('alpha\n\nbeta\n');
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
	});

	test('the heading command rebound to Mod+Alt+2 makes the heading', async () => {
		await selectAcross([{ chord: 'Mod+Alt+2', command: 'heading.cycle', arg: 2 }]);

		await editor.page.keyboard.press('ControlOrMeta+Alt+2');

		await editor.bridge.waitForSourceEquals('## alta\n', 3000);
	});

	test('the split rebound to Alt+Enter splits', async () => {
		await selectAcross([{ chord: 'Alt+Enter', command: 'block.split' }]);

		await editor.page.keyboard.press('Alt+Enter');

		await editor.bridge.waitForSourceEquals('al\n\nta\n', 3000);
	});
});

// A caret in a gap focuses a hidden host, so the root handler declines and the host resolves the
// binding itself; with no block or kind to fall back on, nothing else can run the rebound command.
test.describe('override fires where no block holds focus', () => {
	test('Mod+Alt+U undo fires at the gap caret between two blocks', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('| a | b |\n| - | - |\n| c | d |\n\n```\ncode\n```\n');
		await setKeybindings(editor, [{ chord: 'Mod+Alt+U', command: 'history.undo' }]);

		await editor.page.locator('.table-cell').nth(3).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.type('Z');
		await expect.poll(() => editor.bridge.getSource()).toContain('dZ');

		await editor.page.keyboard.press('ArrowDown');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 1 });

		await editor.page.keyboard.press('ControlOrMeta+Alt+u');
		await expect.poll(() => editor.bridge.getSource()).not.toContain('dZ');
	});
});

// Mod+Alt+U has no built-in binding, so undo fires only through this editor's override. Drives
// every editable block through its own dispatchKeyCommand call.
test.describe('override fires on every leaf dispatch surface', () => {
	const surfaces = [
		{ name: 'paragraph', content: 'para\n', focus: '.text-editable-block' },
		{ name: 'code', content: '```\ncode\n```\n', focus: '.code-block' },
		{
			name: 'table',
			content: '| a | b |\n| - | - |\n| c | d |\n',
			focus: '.table-block [contenteditable]'
		}
	];
	for (const s of surfaces) {
		test(`Mod+Alt+U undo fires in ${s.name}`, async ({ page }) => {
			const editor = new EditorPage(page);
			await editor.goto();
			await editor.loadContent(s.content);
			await setKeybindings(editor, [{ chord: 'Mod+Alt+U', command: 'history.undo' }]);
			await editor.page.locator(s.focus).first().click();
			await editor.page.keyboard.press('End');
			await editor.page.keyboard.type('Z');
			await expect.poll(() => editor.bridge.getSource()).toContain('Z');
			await editor.page.keyboard.press('ControlOrMeta+Alt+u');
			await expect.poll(() => editor.bridge.getSource()).not.toContain('Z');
		});
	}
});

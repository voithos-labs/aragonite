import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// What a code block's content regions may HOLD, as opposed to where an edit may land
// (fence-ranged-edit.spec.ts). Requirements: fence-content-validity.md.

const SOURCE = '```js\nconst x = 1\n```\n\n# Heading\n';

test.describe('code block — content the fence cannot hold', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).click();
	});

	test('a fence run typed on a body line grows the fence instead of closing it', async () => {
		await editor.focusBlock(0, 17); // end of the body line
		await editor.page.keyboard.press('Enter');
		await editor.typeText('```');
		await editor.bridge.waitForSourceContains('````');

		expect(await editor.bridge.getSource()).toBe('````js\nconst x = 1\n```\n````\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.bridge.getBlockKind(1)).toBe('heading');
	});

	test('a backtick typed into the info string is inert', async () => {
		await editor.focusBlock(0, 5); // end of "js"
		await editor.typeSlowly('`');
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('a paste lands in the info string without the backticks it carried', async () => {
		await editor.seedClipboard('x`y');
		await editor.focusBlock(0, 5);
		await editor.paste();
		await editor.bridge.waitForSourceContains('jsxy');

		expect(await editor.bridge.getSource()).toBe('```jsxy\nconst x = 1\n```\n\n# Heading\n');
	});

	test('a pasted fence run on a body line grows the fence', async () => {
		await editor.seedClipboard('```');
		await editor.focusBlock(0, 17);
		await editor.page.keyboard.press('Enter');
		await editor.paste();
		await editor.bridge.waitForSourceContains('````');

		expect(await editor.bridge.getSource()).toBe('````js\nconst x = 1\n```\n````\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});
});

// A run already in the body is safe until a gesture MOVES it into terminator position — those
// gestures rewrite the display without adding a character, reaching the same corruption by another
// door.
test.describe('code block — gestures that make an existing run a terminator', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter splitting a body line around a mid-line run grows the fence', async () => {
		await editor.loadContent('```js\nx```\n```\n\n# Heading\n');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 7); // between "x" and the run
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('````');

		expect(await editor.bridge.getSource()).toBe('````js\nx\n```\n````\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('Shift+Tab dedenting an indented run into column 0 grows the fence', async () => {
		await editor.loadContent('```js\n    ```\n```\n\n# Heading\n');
		await editor.getBlock(0).click();
		await editor.focusBlock(0, 14); // on the indented run
		await editor.page.keyboard.press('Shift+Tab');
		await editor.bridge.waitForSourceContains('````');

		expect(await editor.bridge.getSource()).toBe('````js\n```\n````\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});

// The escalation is scoped to a CLOSED fence: typing your own closer is authoring, not a collision.
test.describe('code block — closing a fence by typing it', () => {
	test('type ```, Enter, code, Enter, ``` yields one closed block', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('\n');
		await editor.focusBlockStart(0);
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```');

		await editor.page.keyboard.press('Enter');
		await editor.typeText('code');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('```');
		await editor.bridge.waitForSourceContains('code');

		// The fixture's blank line IS the block the caret sits in, so the fence fills it: a
		// leading blank would be one more block, which the count below reads as the same doc.
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});
});

test.describe('code block — the tilde twin', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('~~~yaml\nkey: 1\n~~~\n\n# Heading\n');
		await editor.getBlock(0).click();
	});

	test('a tilde run typed on a body line grows a tilde fence', async () => {
		await editor.focusBlock(0, 14); // end of "key: 1"
		await editor.page.keyboard.press('Enter');
		await editor.typeText('~~~');
		await editor.bridge.waitForSourceContains('~~~~');

		expect(await editor.bridge.getSource()).toBe('~~~~yaml\nkey: 1\n~~~\n~~~~\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});

	// GFM forbids backticks only in a BACKTICK fence's info string, so a tilde fence keeps them.
	test('a backtick typed into a tilde info string survives', async () => {
		await editor.focusBlock(0, 7); // end of "yaml"
		await editor.typeText('`');
		await editor.bridge.waitForSourceContains('yaml`');

		expect(await editor.bridge.getSource()).toBe('~~~yaml`\nkey: 1\n~~~\n\n# Heading\n');
	});
});

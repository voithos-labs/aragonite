import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// What a code block's content regions may HOLD, as opposed to where an edit may land
// (fence-ranged-edit.spec.ts). Two characters used to break the fence from inside a
// region the contract calls editable, and the heading below each fixture is what a
// broken fence swallows. Requirements: fence-content-validity.md.

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

	test('a paste lands in the info string without the backticks it carried', async ({ page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('x`y'));
		await editor.focusBlock(0, 5);
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('jsxy');

		expect(await editor.bridge.getSource()).toBe('```jsxy\nconst x = 1\n```\n\n# Heading\n');
	});

	test('a pasted fence run on a body line grows the fence', async ({ page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('```'));
		await editor.focusBlock(0, 17);
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains('````');

		expect(await editor.bridge.getSource()).toBe('````js\nconst x = 1\n```\n````\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});
});

// A run already sitting in the body as ordinary content — mid-line, or indented past
// the closer limit — is safe until a gesture MOVES it into terminator position. Those
// gestures rewrite the display without adding a character, which is why they reach the
// same corruption through a different door.
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

// The escalation is scoped to a CLOSED fence so that this stays possible: closing a
// block by typing its own closer is authoring, not a collision.
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

		// The fixture's own blank line survives as the block's leading trivia.
		expect(await editor.bridge.getSource()).toBe('\n```\ncode\n```\n');
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

	// A tilde fence's info string may hold backticks — GFM only forbids them in a
	// BACKTICK fence's, so nothing is dropped here.
	test('a backtick typed into a tilde info string survives', async () => {
		await editor.focusBlock(0, 7); // end of "yaml"
		await editor.typeText('`');
		await editor.bridge.waitForSourceContains('yaml`');

		expect(await editor.bridge.getSource()).toBe('~~~yaml`\nkey: 1\n~~~\n\n# Heading\n');
	});
});

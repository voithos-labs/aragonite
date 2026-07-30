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

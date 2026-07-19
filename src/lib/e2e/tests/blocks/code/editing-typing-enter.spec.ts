import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Typing and Enter behavior inside a fenced code block: plain typing, literal
// newline insertion, mid-line splits, and the open/closed fence Enter paths.
// Block-exit navigation, keyboard parity, highlighting, paste, and indent live
// in sibling editing-*.spec.ts files.

test.describe('code block editing — happy paths', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing inside code block updates source', async () => {
		await editor.loadContent('```javascript\nconst x = 42;\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText('\nconst y = 99;');
		await editor.bridge.waitForSourceContains('const x = 42;');
		const source = await editor.bridge.getSource();
		expect(source).toContain('const x = 42;');
		expect(source).toContain('const y = 99;');
	});

	test('Enter creates newline inside code block, does not split', async () => {
		await editor.loadContent('```\nline one\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('line two');
		await editor.bridge.waitForSourceContains('line one\nline two');
		expect(await editor.bridge.getBlockCount()).toBe(1);
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('plain Enter inserts a newline at the exact cursor position', async ({ page }) => {
		// Regression: default browser `insertParagraph` produced <div>/<br> with zero textContent change.
		await editor.loadContent('```\nabc\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 5; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```\na\nbc\n```\n');
	});

	test('plain Enter at end of body line inserts a blank line before the closer', async ({
		page
	}) => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceEquals('```\nfoo\n\n```\n');
	});

	test('Enter twice from end of body line exits via blank-line path', async ({ page }) => {
		await editor.loadContent('```\nsome code\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 13; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('some code\n\n```');
		await editor.page.keyboard.press('Enter');
		await editor.typeText('after code');
		await editor.bridge.waitForSourceContains('after code');
		const source = await editor.bridge.getSource();
		expect(source).toContain('```\nsome code\n```');
		expect(source).not.toContain('some code\n\n```');
		expect(source.indexOf('after code')).toBeGreaterThan(source.lastIndexOf('```'));
	});

	test('Enter at end of a closed fence places the caret on the new line (typed text follows)', async ({
		page
	}) => {
		await editor.loadContent('```\nfoo\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 7; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.page.keyboard.press('Enter');
		await editor.typeText('bar');
		await editor.bridge.waitForSourceEquals('```\nfoo\nbar\n```\n');
	});

	test('Enter at end of an unclosed fence adds a body line and caret lands on it', async () => {
		// Regression: Chromium routed the next typed character BEFORE the trailing \n in unclosed fences.
		await editor.loadContent('```js\nconst x = 1\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await editor.getBlock(0).click();
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');
		await editor.typeText('const y = 2');
		await editor.bridge.waitForSourceContains('const x = 1\nconst y = 2');
	});

	test('Enter mid-line in a multi-line code block splits at the cursor', async ({ page }) => {
		await editor.loadContent('```\naaaaa\nbbbbb\nccccc\n```\n');
		await editor.getBlock(0).click();
		await editor.focusBlockStart(0);
		for (let i = 0; i < 12; i++) {
			await page.keyboard.press('ArrowRight');
		}
		await editor.page.keyboard.press('Enter');
		await editor.typeText('X');
		await editor.bridge.waitForSourceEquals('```\naaaaa\nbb\nXbbb\nccccc\n```\n');
	});

	test('typing at the body start (opener-line end) lands in the body, not the opener', async ({
		page
	}) => {
		// Chromium under `white-space: pre` mis-routes an insertText when the caret
		// sits at the end of a `\n` nested inside a styled span — the typed char lands
		// BEFORE the `\n`, in the opener line. The renderer wraps each fence line in
		// `.md-fence-line` so reading/preview can hide it; this pins that the wrapper
		// did NOT reintroduce the mis-route. Caret at DOM offset 6 = end of the opener
		// `\n` = body start.
		await editor.loadContent('```js\nconst x = 1;\n```\n');
		await editor.focusBlockStart(0);
		for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
		await editor.typeText('z');
		await editor.bridge.waitForSourceEquals('```js\nzconst x = 1;\n```\n');
	});

	test('code block content round-trips through source', async () => {
		await editor.loadContent('```python\ndef hello():\n    pass\n```\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('End');
		await editor.typeText('\n    return 42');
		await editor.bridge.waitForSourceMatches(/```python/);
		const source = await editor.bridge.getSource();
		expect(source).toMatch(/```python/);
		expect(source).toContain('def hello():');
		expect(source).toContain('return 42');
		expect(source).toMatch(/```\s*$/m);
	});
});

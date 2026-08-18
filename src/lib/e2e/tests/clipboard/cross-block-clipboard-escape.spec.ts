import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// A cross-block clipboard event landing on `document.body` rather than a block surface
// (requirements/clipboard/cross-block-clipboard-escape.md). The trigger is a focus endpoint
// hosting NO caret: the park is a no-op there, so Chromium retargets to the body.

const IMAGE_ONLY_DOC = 'first para\n\nsecond para\n\n![cat](/test-fixtures/sample.png)\n';
const RULE_DOC = 'first para\n\nsecond para\n\n---\n';

test.describe('cross-block clipboard with a caret-less focus endpoint', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	async function selectWholeDocument(): Promise<void> {
		await editor.page.keyboard.press('Control+a');
		await editor.page.keyboard.press('Control+a');
		await editor.waitForCrossBlock(true);
	}

	test('Ctrl+C copies the document when the last block is an image', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await editor.seedClipboard('UNTOUCHED');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		const clip = await editor.readClipboard();
		expect(clip).toContain('first para');
		expect(clip).toContain('second para');
		expect(clip).toContain('sample.png');
	});

	test('Ctrl+C copies the document when the last block is a thematic break', async () => {
		await editor.loadContent(RULE_DOC);
		await editor.seedClipboard('UNTOUCHED');
		await editor.focusBlockStart(0);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		expect(await editor.readClipboard()).toContain('first para');
	});

	test('Ctrl+X copies the document and empties it', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await editor.seedClipboard('UNTOUCHED');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+x');
		await editor.waitForClipboardWrite();
		await editor.bridge.waitForSourceNotContains('first para');

		expect(await editor.readClipboard()).toContain('first para');
		expect(await editor.bridge.getSource()).not.toContain('second para');
	});

	test('Ctrl+V replaces the selection', async () => {
		await editor.loadContent(IMAGE_ONLY_DOC);
		await editor.seedClipboard('replacement text');
		await editor.focusBlockEnd(2);
		await selectWholeDocument();

		await editor.paste('Control+v');
		await editor.bridge.waitForSourceContains('replacement text');

		const source = await editor.bridge.getSource();
		expect(source).not.toContain('first para');
		expect(source).not.toContain('sample.png');
	});

	// The listeners are on `document`, so every copy enters them. These are the two surfaces
	// the gate's narrowness exists for, mounted for REAL rather than approximated by a bare
	// <input>: a host header whose contenteditable sits inside the root, and the find bar.
	test.describe('surfaces inside the editor root keep their own clipboard', () => {
		test.beforeEach(async () => {
			await editor.goto('?header=on');
			await editor.loadContent(IMAGE_ONLY_DOC);
			await editor.focusBlockEnd(2);
			await selectWholeDocument();
			await editor.seedClipboard('UNTOUCHED');
		});

		for (const [label, selector] of [
			['host header contenteditable', '[data-testid="hero-note"]'],
			['host header input', '[data-testid="hero-title"]']
		] as const) {
			test(`copying from the ${label} copies its own text`, async () => {
				await editor.page.locator(selector).click();
				await editor.page.keyboard.press('Control+a');
				await editor.page.keyboard.press('Control+c');
				await editor.waitForClipboardWrite();

				const clip = await editor.readClipboard();
				expect(clip).not.toContain('first para');
				expect(clip.length).toBeGreaterThan(0);
			});
		}

		test('copying from the find input copies the query, not the document', async () => {
			await editor.page.keyboard.press('Control+f');
			const input = editor.page.locator('.search-bar input').first();
			await input.waitFor({ state: 'visible' });
			await input.click();
			await editor.page.keyboard.type('needle');
			await editor.page.keyboard.press('Control+a');
			await editor.page.keyboard.press('Control+c');
			await editor.waitForClipboardWrite();

			expect(await editor.readClipboard()).toBe('needle');
		});
	});

	test('a copy a block surface does receive is still written once', async () => {
		await editor.loadContent('first para\n\nsecond para\n\nthird para\n');
		await editor.seedClipboard('UNTOUCHED');
		await editor.focusBlockStart(0);
		await selectWholeDocument();

		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		expect(await editor.readClipboard()).toBe('first para\n\nsecond para\n\nthird para');
	});
});

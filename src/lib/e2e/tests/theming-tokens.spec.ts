import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// `--editor-font-size` sets the editor's base text size, and every construct is sized in `em`
// from it, so one declaration by the app scales the whole editor. Only a real browser can
// answer this, since computed font sizes and how `:where()` loses to other rules are exactly
// what jsdom does not have.

const DOC = '# Heading one\n\nParagraph text.\n';

async function fontSizes(editor: EditorPage): Promise<{ heading: string; paragraph: string }> {
	return {
		heading: await editor.getBlock(0).evaluate((el) => getComputedStyle(el).fontSize),
		paragraph: await editor.getBlock(1).evaluate((el) => getComputedStyle(el).fontSize)
	};
}

test.describe('--editor-font-size', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(DOC);
	});

	test('a host scales the editor by declaring the token at .editor scope', async ({ page }) => {
		const before = await fontSizes(editor);
		await page.addStyleTag({ content: '.editor { --editor-font-size: 20px; }' });
		const after = await fontSizes(editor);

		expect(after.paragraph).toBe('20px');
		// The heading is sized from the same base (2em), so everything scales together; a
		// heading given its own fixed size would stay where it is.
		expect(after.heading).toBe('40px');
		expect(before.paragraph).not.toBe(after.paragraph);
	});

	test('the opt-in class default shadows a value inherited from above it', async ({ page }) => {
		const before = await fontSizes(editor);
		// The default sits on `.aragonite-editor-theme`, which this route carries, and a value
		// declared on the element beats an inherited one whatever its specificity.
		await page.addStyleTag({ content: 'body { --editor-font-size: 20px; }' });
		expect(await fontSizes(editor)).toEqual(before);
	});

	test('a value declared below the theme scope reaches the editor', async ({ page }) => {
		// The wrapper between the theme class and the editor root: nothing declares the value
		// again below it, so a themed app sizes the editor from its own wrapper.
		await page.addStyleTag({ content: '.editor-slot { --editor-font-size: 20px; }' });
		const after = await fontSizes(editor);

		expect(after.paragraph).toBe('20px');
		expect(after.heading).toBe('40px');
	});

	test('a host bridges an ancestor value through a declaration at .editor scope', async ({
		page
	}) => {
		await page.addStyleTag({
			content:
				'.editor-slot { --host-zoom: 24px; } .editor { --editor-font-size: var(--host-zoom, 1rem); }'
		});
		const after = await fontSizes(editor);

		expect(after.paragraph).toBe('24px');
		expect(after.heading).toBe('48px');
	});
});

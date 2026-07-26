import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

// `--editor-font-size` is the editor's type-scale root: the root sizes its text
// from it and every construct is `em`-relative, so one host declaration scales the
// surface. Only real layout can answer this — computed font sizes and the `:where()`
// shadowing rule are exactly what jsdom does not have.

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
		// The heading rides the same root (2em), so the scale moves as one — a heading
		// re-anchored to its own absolute size would stay put here.
		expect(after.heading).toBe('40px');
		expect(before.paragraph).not.toBe(after.paragraph);
	});

	test('the editor default shadows a value inherited from a host wrapper', async ({ page }) => {
		const before = await fontSizes(editor);
		// Declared on the host's own wrapper, one level above the editor root. The
		// token's default lives ON `.editor`, and a direct declaration beats an
		// inherited one whatever its specificity — so this is invisible to the editor.
		await page.addStyleTag({ content: '.editor-slot { --editor-font-size: 20px; }' });
		expect(await fontSizes(editor)).toEqual(before);
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

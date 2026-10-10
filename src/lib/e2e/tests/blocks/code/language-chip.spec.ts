import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The way to set a fence's info string in the modes that paint no fence.
// Requirements: `e2e/requirements/blocks/code/language-chip.md`.

const SOURCE = '```js\nconst x = 1\n```\n\n# Heading\n';
const EMPTY_FENCE = '```\n```\n\n# Heading\n';
const NESTED_FENCE = '> a quote\n>\n> ```js\n> const x = 1\n> ```\n';

// The `.code-rail` (the code block's side gutter) appears on hover; the language control is named
// so its sibling buttons (copy, run, overflow) never match these locators.
const rail = (page: Page) => page.locator('.code-rail');
const chipButton = (page: Page) => page.locator('.code-lang-button');
// The field lives in the picker, not in the gutter: the chip is a fixed-width button that
// never swaps, so opening the picker shifts nothing beside it.
const chipInput = (page: Page) => page.locator('.code-lang-picker input');

/** The editable modes that hide a fence: the chip's whole audience, minus reading. */
const WRITING_MODES = ['live', 'preview-inline', 'preview-block'] as const;

async function loadIn(page: Page, mode: string, doc = SOURCE): Promise<EditorPage> {
	const editor = new EditorPage(page);
	await editor.goto(`?presentationMode=${mode}`);
	await editor.loadContent(doc);
	// An unrecognized query param falls back to source, where the fence paints and no
	// scenario below means what it says.
	await expect(editor.editorContainer).toHaveAttribute('data-presentation', mode);
	return editor;
}

const loadLive = (page: Page, doc = SOURCE) => loadIn(page, 'live', doc);

/** Hover the block, then open the field: the pointer gesture that shows the chip. */
async function openChip(editor: EditorPage): Promise<void> {
	await editor.getBlock(0).hover();
	await chipButton(editor.page).click();
	await expect(chipInput(editor.page)).toBeVisible();
}

test.describe('code language chip: when it shows', () => {
	test('source mode renders no chip: the fence is on screen already', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(SOURCE);
		await editor.getBlock(0).hover();

		// The fixture is the block the chip belongs to: an absence assertion over a document
		// that parsed some other way passes for the wrong reason.
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await expect(rail(page)).toHaveCount(0);
	});

	test('every writing mode reveals it on hover, reading the info string’s first token', async ({
		page
	}) => {
		const editor = await loadLive(page);
		for (const mode of WRITING_MODES) {
			await test.step(mode, async () => {
				await editor.setPresentationMode(mode);
				await page.mouse.move(0, 0);

				await expect(rail(page)).toHaveCSS('opacity', '0');
				await editor.getBlock(0).hover();
				await expect(chipButton(page)).toHaveText('js');
				await expect(rail(page)).toHaveCSS('opacity', '1');
			});
		}
	});

	test('live mode reveals it for a caret inside the block, pointer away', async ({ page }) => {
		const editor = await loadLive(page);
		await editor.focusBlock(0, 8);
		await page.mouse.move(0, 0);

		await expect(rail(page)).toHaveCSS('opacity', '1');
	});

	test('an empty info string reads "text"', async ({ page }) => {
		const editor = await loadLive(page, '```\nconst x = 1\n```\n\n# Heading\n');
		await editor.getBlock(0).hover();

		await expect(chipButton(page)).toHaveText('text');
	});

	// A fence with no content gets the side gutter too: the caret arriving completes the bare fence
	// so there is a body line to sit on, then offers a language through the picker.
	test('a content-empty fence gets the rail; the caret arriving completes it and asks for a language', async ({
		page
	}) => {
		const editor = await loadLive(page, EMPTY_FENCE);
		await editor.getBlock(0).hover();

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		await expect(rail(page)).toHaveCount(1);
		await expect(chipButton(page)).toHaveText('text');
		await expect(editor.getBlock(0).locator('.md-fence-line').first()).toHaveCSS('display', 'none');

		await editor.getBlock(0).click();
		await editor.bridge.waitForSourceEquals('```\n\n```\n\n# Heading\n');
		await expect(chipInput(page)).toBeVisible();

		// Escape hands the caret back to the body line it completed.
		await page.keyboard.press('Escape');
		await expect(chipInput(page)).toHaveCount(0);
		await page.keyboard.type('x');
		await editor.bridge.waitForSourceEquals('```\nx\n```\n\n# Heading\n');
	});

	// The hover rule uses the child combinator: hovering a container is not hovering its block.
	test('a container’s hover leaves its nested block’s chip alone', async ({ page }) => {
		const editor = await loadLive(page, NESTED_FENCE);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		await expect(rail(page)).toHaveCount(1);

		await page.locator('[data-block-path="[0,0]"]').hover();
		await expect(rail(page)).toHaveCSS('opacity', '0');

		await page.locator('[data-block-path="[0,1]"]').hover();
		await expect(rail(page)).toHaveCSS('opacity', '1');
	});

	test('reading mode shows the chip inert: a click opens no field', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto('?presentationMode=reading');
		await editor.loadContent(SOURCE);
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');

		await editor.getBlock(0).hover();
		await expect(chipButton(page)).toHaveText('js');
		await chipButton(page).click();
		await expect(chipInput(page)).toHaveCount(0);
	});
});

test.describe('code language chip: the commit', () => {
	// Every writing mode, because a preview mode shows the fence again while the field holds
	// focus (the block reads as focused), so the chip commits over markers back on screen.
	test('every writing mode: Enter rewrites the info string and nothing else', async ({ page }) => {
		const editor = await loadLive(page);
		for (const mode of WRITING_MODES) {
			await test.step(mode, async () => {
				await editor.setPresentationMode(mode);
				await editor.loadContent(SOURCE);
				await openChip(editor);
				await page.keyboard.type('ts');
				await page.keyboard.press('Enter');
				await editor.bridge.waitForSourceContains('```ts');

				expect(await editor.bridge.getSource()).toBe('```ts\nconst x = 1\n```\n\n# Heading\n');
				expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
				expect(await editor.bridge.getBlockCount()).toBe(2);
			});
		}
	});

	// `text` is the picker's spelling of "no language": the field opens empty, so clearing means
	// choosing that row rather than emptying a field.
	test('choosing “text” clears the info string', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('text');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('```\nconst');

		expect(await editor.bridge.getSource()).toBe('```\nconst x = 1\n```\n\n# Heading\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	// A same-length info string would land the caret right whatever the opener's width did to
	// the offset, so the commit here lengthens the line.
	test('the caret comes back to the body’s first offset, ready to type', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('typescript');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('```typescript');

		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('Xconst');
		expect(await editor.bridge.getSource()).toBe('```typescript\nXconst x = 1\n```\n\n# Heading\n');
	});
});

test.describe('code language chip, cancelling', () => {
	test('Escape leaves the source byte-identical', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('ts');
		await page.keyboard.press('Escape');
		await expect(chipInput(page)).toHaveCount(0);
		// The chip is its own input, outside every editable block: no keydown answer is recorded.
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});

	test('clicking away leaves the source byte-identical', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('ts');
		await editor.getBlock(1).click();
		await expect(chipInput(page)).toHaveCount(0);
		// A click, not a keystroke.
		await editor.waitForNoSourceMutation();

		expect(await editor.bridge.getSource()).toBe(SOURCE);
	});
});

// One entry, isolated on both sides: the commit joins the same debounced batch typing does, so
// a burst either side of it would otherwise ride the chip's single Mod+Z.
test.describe('code language chip: one undo entry', () => {
	test('a body character typed before the commit survives one Mod+Z', async ({ page }) => {
		const editor = await loadLive(page);
		await editor.focusBlock(0, 6);
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Zconst');

		await openChip(editor);
		await page.keyboard.type('ts');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('```ts');

		await editor.undo();
		await editor.bridge.waitForSourceContains('```js');
		expect(await editor.bridge.getSource()).toBe('```js\nZconst x = 1\n```\n\n# Heading\n');
	});

	test('a body character typed after the commit goes alone on one Mod+Z', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('ts');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('```ts');

		await page.keyboard.type('X');
		await editor.bridge.waitForSourceContains('Xconst');

		await editor.undo();
		await editor.bridge.waitForSourceContains('```ts\nconst');
		expect(await editor.bridge.getSource()).toBe('```ts\nconst x = 1\n```\n\n# Heading\n');
	});
});

test.describe('code language chip: across a source swap', () => {
	test('a typed field is dropped, not written into the next document', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('py');
		await page.evaluate(() => (window as any).__test.startEditOpCapture());

		const next = '```rust\nfn main() {}\n```\n\nbody\n';
		await page.evaluate((md) => (window as any).__test.setSource(md), next);
		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();

		expect(await editor.bridge.getSource()).toBe(next);
		expect(await page.evaluate(() => (window as any).__test.stopEditOpCapture())).toEqual([]);
	});
});

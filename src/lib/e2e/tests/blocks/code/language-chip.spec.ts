import type { Page } from '@playwright/test';
import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// The fence-info door for the modes that paint no fence (issue #142).
// Requirements: e2e/requirements/blocks/code/language-chip.md.

const SOURCE = '```js\nconst x = 1\n```\n\n# Heading\n';
const EMPTY_FENCE = '```\n```\n\n# Heading\n';
/** Trailing spaces `meta.info` trims away and the block's bytes keep. */
const PADDED_FENCE = '```js  \nconst x = 1\n```\n\n# Heading\n';
const NESTED_FENCE = '> a quote\n>\n> ```js\n> const x = 1\n> ```\n';

// The rail is the revealed unit — it carries the opacity the chip used to. The language
// control is one of its children, named specifically so the action buttons beside it (copy,
// and the host-gated run/overflow) never resolve into these locators.
const rail = (page: Page) => page.locator('.code-rail');
const chipButton = (page: Page) => page.locator('.code-lang-button');
// The field lives IN the picker, not in the rail: the chip is a fixed-width button that
// never swaps, so opening the picker shifts nothing beside it.
const chipInput = (page: Page) => page.locator('.code-lang-picker input');

/** The editable rungs that hide a fence — the chip's whole audience, minus reading. */
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

/** Hover the block, then open the field — the pointer gesture the chip is revealed by. */
async function openChip(editor: EditorPage): Promise<void> {
	await editor.getBlock(0).hover();
	await chipButton(editor.page).click();
	await expect(chipInput(editor.page)).toBeVisible();
}

test.describe('code language chip — when it shows', () => {
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

	for (const mode of WRITING_MODES) {
		test(`${mode} reveals it on hover, reading the info string’s first token`, async ({ page }) => {
			const editor = await loadIn(page, mode);

			await expect(rail(page)).toHaveCSS('opacity', '0');
			await editor.getBlock(0).hover();
			await expect(chipButton(page)).toHaveText('js');
			await expect(rail(page)).toHaveCSS('opacity', '1');
		});
	}

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

	// A content-empty fence gets the rail like any other. Its own markers paint only while the
	// caret is inside (`cursor/widget-offset.ts` mirrors that gate), and the caret arriving
	// completes the bare fence so there is a body line to sit on, then offers a language: the
	// picker is the authoring path, and a fence with no language is exactly where it is wanted.
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

	// The reveal takes the child combinator: a container's hover is not its nested block's.
	test('a container’s hover leaves its nested block’s chip alone', async ({ page }) => {
		const editor = await loadLive(page, NESTED_FENCE);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		await expect(rail(page)).toHaveCount(1);

		await page.locator('[data-block-path="[0,0]"]').hover();
		await expect(rail(page)).toHaveCSS('opacity', '0');

		await page.locator('[data-block-path="[0,1]"]').hover();
		await expect(rail(page)).toHaveCSS('opacity', '1');
	});

	test('reading mode shows the chip inert — a click opens no field', async ({ page }) => {
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

test.describe('code language chip — the commit', () => {
	// Every writing rung, because a preview one REVEALS the fence while the field holds focus
	// (the block reads as focused), so the chip commits over chrome that is on screen again.
	for (const mode of WRITING_MODES) {
		test(`${mode}: Enter rewrites the info string and nothing else`, async ({ page }) => {
			const editor = await loadIn(page, mode);
			await openChip(editor);
			await page.keyboard.type('ts');
			await page.keyboard.press('Enter');
			await editor.bridge.waitForSourceContains('```ts');

			expect(await editor.bridge.getSource()).toBe('```ts\nconst x = 1\n```\n\n# Heading\n');
			expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
			expect(await editor.bridge.getBlockCount()).toBe(2);
		});
	}

	// `text` is the picker's spelling of "no language" — the field no longer opens seeded with
	// the current one, so clearing is choosing that row rather than emptying a field.
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

	// The undo is the discriminator: a phantom info write would take the trailing spaces back
	// and leave the typed character standing.
	test('a bare Enter on a padded fence line writes nothing', async ({ page }) => {
		const editor = await loadLive(page, PADDED_FENCE);
		await editor.focusBlock(0, 8);
		await page.keyboard.type('Z');
		await editor.bridge.waitForSourceContains('Zconst');

		await openChip(editor);
		// The field opens EMPTY and the highlight sits on the block's own language, so a bare
		// Enter re-commits `js` — which the commit gate reads as unchanged, and writes nothing.
		await expect(chipInput(page)).toHaveValue('');
		await expect(chipButton(page)).toHaveText('js');
		await page.keyboard.press('Enter');
		// The chip is its own input, outside every editable surface: no verdict is recorded.
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe('```js  \nZconst x = 1\n```\n\n# Heading\n');

		await editor.undo();
		await editor.bridge.waitForSourceNotContains('Zconst');
		expect(await editor.bridge.getSource()).toBe(PADDED_FENCE);
	});

	test('a backtick cannot reach an unclosed backtick fence’s info string', async ({ page }) => {
		const editor = await loadLive(page, '```js\nconst x = 1\n');
		await openChip(editor);
		await page.keyboard.type('a`b');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('```ab');

		expect(await editor.bridge.getSource()).toBe('```ab\nconst x = 1\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
	});

	test('a leading fence marker is dropped rather than lengthening the fence', async ({ page }) => {
		const editor = await loadLive(page, '~~~js\nconst x = 1\n~~~\n\n# Heading\n');
		await openChip(editor);
		await page.keyboard.type('~~ts');
		await page.keyboard.press('Enter');
		await editor.bridge.waitForSourceContains('~~~ts');

		expect(await editor.bridge.getSource()).toBe('~~~ts\nconst x = 1\n~~~\n\n# Heading\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
	});
});

test.describe('code language chip — cancelling', () => {
	test('Escape leaves the source byte-identical', async ({ page }) => {
		const editor = await loadLive(page);
		await openChip(editor);
		await page.keyboard.type('ts');
		await page.keyboard.press('Escape');
		await expect(chipInput(page)).toHaveCount(0);
		// The chip is its own input, outside every editable surface: no verdict is recorded.
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

// One entry, isolated on BOTH sides: the commit reaches the same debounced batch typing
// does, so a burst either side of it would otherwise ride the chip's single Mod+Z.
test.describe('code language chip — one undo entry', () => {
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

import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../editor-page';
import { attachIme } from '../simulation/ime';

// The `placeholder` prop in a real browser (requirements/placeholder.md): what paints, where it
// paints, and that the caret, the bytes and the undo stack never notice it.

const HINT = 'Start writing';

/** The editable element of the block at `path`, whatever its `contenteditable` value. */
const surfaceAt = (page: Page, path: number[]) =>
	page.locator(`[data-block-path='${JSON.stringify(path)}'] [contenteditable]`).first();

async function setPlaceholder(page: Page, form: 'kind' | 'focused'): Promise<void> {
	await page.evaluate((f) => {
		const forms = {
			kind: (b: { kind: string }) => `Empty ${b.kind}`,
			focused: (b: { focused: boolean }) => (b.focused ? 'Type here' : null)
		};
		(window as any).__test.setPlaceholder(forms[f]);
	}, form);
}

/** Where the caret paints: its own rect, or on an empty line, the line break it sits before. */
async function caretPoint(page: Page): Promise<{ x: number; y: number }> {
	return page.evaluate(() => {
		const range = window.getSelection()!.getRangeAt(0);
		let rect = range.getClientRects()[0];
		if (!rect) {
			const next = range.startContainer.childNodes[range.startOffset] ?? range.startContainer;
			const around = document.createRange();
			around.selectNode(next);
			rect = around.getClientRects()[0];
		}
		return { x: rect.left, y: rect.top };
	});
}

test.describe('placeholder: the string form', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto(`?placeholder=${encodeURIComponent(HINT)}`);
		await editor.loadContent('');
	});

	test('shows on an empty document, goes on the first typed letter, returns when it is deleted', async ({
		page
	}) => {
		const el = surfaceAt(page, [0]);
		await expect(el).toHaveAttribute('data-placeholder', HINT);
		await editor.clickBlock(0);
		await page.keyboard.type('a');
		await editor.bridge.waitForSourceContains('a');
		await expect(el).not.toHaveAttribute('data-placeholder');
		await page.keyboard.press('Backspace');
		await expect(el).toHaveAttribute('data-placeholder', HINT);
	});

	test('never shows in reading mode', async ({ page }) => {
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(surfaceAt(page, [0])).not.toHaveAttribute('data-placeholder');
		await page.getByTestId('presentation-toggle').click();
		await expect(surfaceAt(page, [0])).toHaveAttribute('data-placeholder', HINT);
	});

	test('hides while an IME composes into the empty block', async ({ page }) => {
		const el = surfaceAt(page, [0]);
		await editor.focusBlockStart(0);
		await expect(el).toHaveAttribute('aria-placeholder', HINT);
		const ime = await attachIme(page);
		await ime.compose('か');
		await expect(el).not.toHaveAttribute('data-placeholder');
		await expect(el).not.toHaveAttribute('aria-placeholder');
		expect(await editor.bridge.getSource()).toBe('\n');
	});
});

test.describe('placeholder: the function form', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('follows the caret from block to block', async ({ page }) => {
		await editor.loadContent('\n\n\n');
		await setPlaceholder(page, 'focused');
		await editor.clickBlock(1);
		await expect(surfaceAt(page, [1])).toHaveAttribute('data-placeholder', 'Type here');
		await expect(surfaceAt(page, [0])).not.toHaveAttribute('data-placeholder');

		await editor.clickBlock(0);
		await expect(surfaceAt(page, [0])).toHaveAttribute('data-placeholder', 'Type here');
		await expect(surfaceAt(page, [1])).not.toHaveAttribute('data-placeholder');
	});
});

// One shape per way a block draws what comes before its text.
const SHAPES: { name: string; source: string; path: number[] }[] = [
	{ name: 'paragraph', source: '\n', path: [0] },
	{ name: 'heading', source: '# \n', path: [0] },
	{ name: 'list item', source: '- \n', path: [0, 0, 0] },
	{ name: 'task item', source: '- [ ] \n', path: [0, 0, 0] },
	{ name: 'quote', source: '> \n', path: [0, 0] },
	{ name: 'code block', source: '```\n\n```\n', path: [0] }
];

for (const mode of ['source', 'live'] as const) {
	test.describe(`placeholder in ${mode} mode: the caret keeps its place`, () => {
		for (const shape of SHAPES) {
			test(`${shape.name}: the caret paints at the same point with and without the hint`, async ({
				page
			}) => {
				const editor = new EditorPage(page);
				await editor.goto(`?presentationMode=${mode}`);
				await editor.loadContent(shape.source);
				await page.evaluate((path) => (window as any).__test.placeCaret(path, 'start'), shape.path);
				const bare = await caretPoint(page);

				await setPlaceholder(page, 'kind');
				await expect(surfaceAt(page, shape.path)).toHaveAttribute('data-placeholder', /^Empty /);
				expect(await caretPoint(page)).toEqual(bare);
				expect(await editor.bridge.getSource()).toBe(shape.source);
			});
		}
	});
}

test('placeholder: an empty heading in source mode paints its hint after the visible `# `', async ({
	page
}) => {
	const editor = new EditorPage(page);
	await editor.goto(`?placeholder=${encodeURIComponent(HINT)}`);
	await editor.loadContent('# \n');
	const paint = await surfaceAt(page, [0]).evaluate((el) => {
		const marker = el.querySelector('[data-block-prefix]')!.getBoundingClientRect();
		const hint = getComputedStyle(el, '::after');
		// A positioned hint's `left` reads as its used value, against its containing block.
		let box = el.parentElement!;
		while (getComputedStyle(box).position === 'static') box = box.parentElement!;
		const left = box.getBoundingClientRect().left + box.clientLeft + parseFloat(hint.left);
		return {
			markerRight: marker.right,
			hintLeft: left,
			painted: hint.content,
			before: getComputedStyle(el, '::before').content
		};
	});
	expect(paint.painted).toContain(HINT);
	expect(paint.before).toBe('none');
	expect(Math.abs(paint.hintLeft - paint.markerRight)).toBeLessThan(1);
});

// The preview modes draw the opening fence only on the focused block, so each mode is read focused.
for (const mode of ['source', 'preview-block', 'live'] as const) {
	test(`placeholder in ${mode} mode: an empty code block paints its hint on the body line`, async ({
		page
	}) => {
		const editor = new EditorPage(page);
		await editor.goto(`?presentationMode=${mode}`);
		await editor.loadContent('```\n\n```\n');
		await setPlaceholder(page, 'kind');
		await page.evaluate(() => (window as any).__test.placeCaret([0], 'start'));
		const el = surfaceAt(page, [0]);
		await expect(el).toHaveAttribute('data-placeholder', 'Empty fencedCode');
		const { hintTop, bodyTop } = await el.evaluate((node) => {
			const hint = getComputedStyle(node, '::before');
			// A positioned hint's `top` reads as its used value, against its containing block.
			let box = node.parentElement!;
			while (getComputedStyle(box).position === 'static') box = box.parentElement!;
			const edge = box.getBoundingClientRect().top + box.clientTop;
			// The empty body line is the bare line break between the two fence lines.
			const line = document.createRange();
			line.selectNodeContents([...node.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)!);
			return {
				hintTop: edge + parseFloat(hint.top) + parseFloat(hint.marginTop),
				bodyTop: line.getClientRects()[0].top
			};
		});
		expect(Math.abs(hintTop - bodyTop)).toBeLessThan(2);
	});
}

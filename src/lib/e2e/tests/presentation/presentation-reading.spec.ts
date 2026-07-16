import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { primaryModifier } from '../../platform';
import type { Page } from '@playwright/test';

// Reading mode on /test/editor: markers hidden by CSS (DOM intact), surface
// inert (source stable via the bridge), selection/copy/navigation live.
// Requirements: e2e/requirements/presentation/presentation-reading.md.

const DOC = [
	'# Title',
	'',
	'Some **bold** text',
	'',
	'- alpha',
	'- bravo',
	'1. one',
	'- [ ] task'
].join('\n');

async function toggleReadingMode(page: Page): Promise<void> {
	await page.getByTestId('presentation-toggle').click();
}

test.describe('reading mode — markers', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
	});

	test('root attribute present only in reading mode', async ({ page }) => {
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
		await toggleReadingMode(page);
		await expect(ep.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await toggleReadingMode(page);
		await expect(ep.editorContainer).not.toHaveAttribute('data-presentation');
	});

	test('markers hide from paint but their text stays in the DOM', async ({ page }) => {
		const headingMarker = page.locator('.heading-1 .md-marker').first();
		await expect(headingMarker).toBeVisible();
		await toggleReadingMode(page);
		await expect(headingMarker).toBeHidden();
		// The coordinate-space contract: hidden, never omitted.
		expect(await ep.getBlockText(0)).toBe('# Title');
		expect(await ep.getBlockText(1)).toBe('Some **bold** text');
	});

	test('list markers: ordered stays visible, bullet becomes rendered chrome', async ({ page }) => {
		await toggleReadingMode(page);
		const ambient = ".md-marker[contenteditable='false']";
		await expect(page.locator(`[data-list-marker='ordered'] ${ambient}`).first()).toBeVisible();
		const bulletAmbient = page.locator(`[data-list-marker='bullet'] ${ambient}`).first();
		await expect(bulletAmbient).toBeHidden();
		const bulletContent = await bulletAmbient.evaluate(
			(el) => getComputedStyle(el, '::before').content
		);
		expect(bulletContent).toContain('•');
		await expect(page.locator(`[data-list-marker='task'] .task-checkbox`).first()).toBeVisible();
	});
});

test.describe('reading mode — inertness', () => {
	let ep: EditorPage;
	let baseline: string;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		baseline = await ep.bridge.getSource();
		await toggleReadingMode(page);
	});

	test('typing, Enter, Backspace, and Delete change nothing', async ({ page }) => {
		await ep.clickBlock(1);
		await page.keyboard.type('XYZ');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Delete');
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
		expect(await ep.getDomBlockCount()).toBeGreaterThan(0);
	});

	test('paste and cut change nothing (cut degrades to copy)', async ({ page }) => {
		await ep.clickBlock(1);
		await page.evaluate(() => navigator.clipboard.writeText('PASTED'));
		await page.keyboard.press(`${primaryModifier}+v`);
		await ep.dragFromTo([1], 0, [1], 4);
		await page.keyboard.press(`${primaryModifier}+x`);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(baseline);
	});

	test('undo is inert against a pre-flip edit', async ({ page }) => {
		await toggleReadingMode(page); // back to source
		await ep.clickBlock(1);
		await ep.typeText('EDIT');
		await ep.bridge.waitForSourceContains('EDIT');
		await toggleReadingMode(page);
		await ep.clickBlock(1);
		await ep.undo();
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toContain('EDIT');
	});

	test('task checkbox is visible but inert', async ({ page }) => {
		// force: CSS drops the checkbox's pointer-events in reading mode — the
		// click must still be attempted to prove the JS belt behind it.
		await page.locator('.task-checkbox').first().click({ force: true });
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toContain('- [ ] task');
	});

	test('mode flip mid-edit commits the edit before going inert', async ({ page }) => {
		await toggleReadingMode(page); // back to source
		await ep.clickBlock(1);
		await ep.typeText('KEPT');
		await toggleReadingMode(page); // blur-class flip: the edit must survive
		await ep.bridge.waitForSourceContains('KEPT');
	});
});

test.describe('reading mode — what stays live', () => {
	let ep: EditorPage;

	test.beforeEach(async ({ page }) => {
		ep = new EditorPage(page);
		await ep.goto();
		await ep.loadContent(DOC);
		await toggleReadingMode(page);
	});

	test('selection + copy yield the rendered text (markers excluded)', async ({ page }) => {
		// Raw "Some **bold** text": endpoints in visible text segments.
		await ep.dragFromTo([1], 0, [1], 11);
		await page.keyboard.press(`${primaryModifier}+c`);
		await ep.waitForClipboardWrite();
		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toBe('Some bold');
	});

	test('toggling back to source restores editing', async ({ page }) => {
		await toggleReadingMode(page);
		await ep.clickBlock(1);
		await ep.typeText('AGAIN');
		await ep.bridge.waitForSourceContains('AGAIN');
	});

	test('round-trip: enter + interact + leave is byte-stable', async ({ page }) => {
		const before = await ep.bridge.getSource();
		await ep.clickBlock(0);
		await page.keyboard.type('zzz');
		await page.keyboard.press('Enter');
		await toggleReadingMode(page);
		await ep.waitForNoSourceMutation();
		expect(await ep.bridge.getSource()).toBe(before);
	});
});

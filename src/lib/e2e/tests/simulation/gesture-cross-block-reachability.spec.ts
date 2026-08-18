import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import type { SimContext } from '../../simulation/invariants';
import { makeSimContext } from './helpers';
import {
	cutSelection,
	deleteSelection,
	extendSelectionAcross,
	pasteOverSelection,
	selectWholeDocument,
	shiftClickAcross,
	typeOverSelection
} from '../../simulation/gestures/cross-block';

// Reachability self-tests: each asserts the dangerous state the gesture CLAIMS to reach
// actually engaged, since a build that silently stayed single-block would be an invisible
// hole in the corruption oracle. The closing negative case proves the guard fails loud.

function makeCtx(page: Page, editor: EditorPage): Promise<SimContext> {
	return makeSimContext(page, editor, 'reach');
}

// Build a cross-block range whose interior is 'pha'..'be': offset 2 in each of the two
// paragraphs, so a real destroy removes those substrings (a boundary-only range would
// merely merge). Returns the ctx the destroy gesture runs on.
async function selectAcrossContent(page: Page, editor: EditorPage): Promise<SimContext> {
	await editor.focusBlockAtPath([0], 2);
	const ctx = await makeCtx(page, editor);
	await shiftClickAcross(ctx, [1], 2);
	return ctx;
}

test.describe('sim gesture reachability: cross-block', () => {
	let editor: EditorPage;
	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// ── Build engagement ──────────────────────────────────────────────────────

	test('Shift+ArrowDown engages a real cross-block selection', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n');
		await editor.focusBlockStart(0);
		await extendSelectionAcross(await makeCtx(page, editor), 'down');
		expect(await editor.bridge.isCrossBlockSelection()).toBe(true);
	});

	test('Shift+Click into another block engages cross-block', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n');
		await editor.focusBlockAtPath([0], 2);
		await shiftClickAcross(await makeCtx(page, editor), [1], 2);
		expect(await editor.bridge.isCrossBlockSelection()).toBe(true);
	});

	test('double select-all escalates to a whole-document cross-block selection', async ({
		page
	}) => {
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await editor.focusBlockStart(1);
		await selectWholeDocument(await makeCtx(page, editor));
		const paths = await editor.bridge.getSelectionPaths();
		expect(paths!.anchor.path[0]).toBe(0);
		expect(paths!.focus.path[0]).toBe(2);
	});

	// ── Destroy over covered content ──────────────────────────────────────────

	for (const key of ['Backspace', 'Delete'] as const) {
		test(`${key} deletes the covered cross-block content`, async ({ page }) => {
			await editor.loadContent('alpha\n\nbeta\n');
			const ctx = await selectAcrossContent(page, editor);
			await deleteSelection(ctx, key);
			const source = await editor.bridge.getSource();
			expect(source).not.toContain('pha');
			expect(source).not.toContain('be');
			expect(await editor.bridge.isCrossBlockActive()).toBe(false);
		});
	}

	test('Cut removes the covered cross-block content', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n');
		const ctx = await selectAcrossContent(page, editor);
		await cutSelection(ctx);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('pha');
		expect(source).not.toContain('be');
		expect(await editor.bridge.isCrossBlockActive()).toBe(false);
	});

	test('type-over replaces the covered cross-block content', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n');
		const ctx = await selectAcrossContent(page, editor);
		await typeOverSelection(ctx, 'Z');
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('pha');
		expect(source).toContain('Z');
	});

	test('paste-over replaces the covered content with the clipboard', async ({ page }) => {
		await editor.loadContent('alpha\n\nbeta\n\nCLIP\n');
		await editor.focusBlockAtPath([2], 0);
		await editor.page.keyboard.press('Shift+End');
		await editor.page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		const ctx = await selectAcrossContent(page, editor);
		await pasteOverSelection(ctx);
		const source = await editor.bridge.getSource();
		expect(source).not.toContain('pha');
		expect(source).toContain('CLIP');
	});

	// ── Loud no-op guard ──────────────────────────────────────────────────────

	test('a build that cannot cross fails loudly (single-block document)', async ({ page }) => {
		await editor.loadContent('lonely\n');
		await editor.focusBlockEnd(0);
		await expect(extendSelectionAcross(await makeCtx(page, editor), 'down')).rejects.toThrow(
			/did not engage/
		);
	});
});

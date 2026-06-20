import { test, expect } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { expectNoNewA11yViolations } from '../../a11y/axe-helper';

// The handle is a mouse-only affordance: rendered for every reorder unit
// (top-level block, list item, blockquote child), revealed by a pure-CSS host
// hover rule, and kept out of the SR/tab flow (aria-hidden, not a button).
// Reveal is opacity-only and the handle is always in the DOM, so toBeVisible()
// would pass even with a broken hover rule — assert the opacity transition
// directly. Keyboard reorder is the accessible path (covered separately).
test.describe('reorder hover handle', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('top-level block: handle is hidden, reveals on hover, and is aria-hidden', async () => {
		await editor.loadContent('- one\n\nplain\n');
		const top = editor.page.locator('.block-host', { hasText: 'plain' }).last();
		const handle = top.locator('.block-drag-handle');

		await expect(handle).toHaveAttribute('aria-hidden', 'true');
		await expect(handle).toHaveCSS('opacity', '0');
		await top.hover();
		await expect(handle).toHaveCSS('opacity', '1');
	});

	test('list item is a reorder unit; its inner paragraph is not (one handle in subtree)', async () => {
		await editor.loadContent('- one\n\nplain\n');
		const item = editor.page.locator('.list-item-block', { hasText: 'one' });
		await item.hover();
		await expect(item.locator('.block-drag-handle')).toHaveCount(1);
		await expect(item.locator('.block-drag-handle')).toHaveCSS('opacity', '1');
	});

	test('blockquote child reveals its own handle on hover', async () => {
		await editor.loadContent('> a\n>\n> b\n');
		const child = editor.page.locator('.blockquote-block .block-host', { hasText: 'b' });
		const handle = child.locator('.block-drag-handle');
		await expect(handle).toHaveCSS('opacity', '0');
		await child.hover();
		await expect(handle).toHaveCSS('opacity', '1');
	});

	test('axe baseline stays green with handles rendered', async ({ page }) => {
		await editor.loadContent('- one\n\nplain\n\n> quoted\n');
		await editor.waitForRenderFlush();
		await expectNoNewA11yViolations(page, 'reorder-handle');
	});

	test('blockDragHandles=false renders no handle, even on hover', async () => {
		await editor.goto('?dragHandles=false');
		await editor.loadContent('- one\n\nplain\n');
		const top = editor.page.locator('.block-host', { hasText: 'plain' }).last();
		await top.hover();
		await expect(editor.page.locator('.block-drag-handle')).toHaveCount(0);
	});
});

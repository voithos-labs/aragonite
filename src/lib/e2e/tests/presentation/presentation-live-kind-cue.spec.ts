import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import type { EditorPage } from '../../editor-page';
import { clickBlockSettled, enterPresentationMode } from './helpers';

// A keystroke that turns its block into another kind shows the new kind's name at the block's
// corner for a moment, and the screen reader hears it once, in the modes that hide markers.
// Requirements: e2e/requirements/presentation/presentation-live-kind-cue.md.

const DOC = 'notes\n';

const host = (page: Page) => page.locator('.block-host[data-block-path="[0]"]');
const announcer = (page: Page) => page.locator('.editor-sr-live-kind');

async function atStartOfFirst(ep: EditorPage, page: Page): Promise<void> {
	await clickBlockSettled(ep, 0);
	await page.keyboard.press('Home');
	await ep.waitForRenderFlush();
}

test.describe('live mode: the kind cue', () => {
	test('a tab typed before `notes` names the code block it made', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await atStartOfFirst(ep, page);

		await page.keyboard.press('Tab');
		await ep.bridge.waitForSourceEquals('\tnotes\n');

		expect(await ep.bridge.getBlockKind(0)).toBe('indentedCode');
		await expect(host(page)).toHaveAttribute('data-kind-cue', 'Code block');
		await expect(announcer(page)).toHaveText('Code block');
		// The fade ends the cue: the attribute leaves once the animation does.
		await expect(host(page)).not.toHaveAttribute('data-kind-cue', /./, { timeout: 5000 });
	});

	test('`# ` typed at a paragraph start names the heading', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await atStartOfFirst(ep, page);

		await page.keyboard.type('# ');
		await ep.bridge.waitForSourceEquals('# notes\n');

		await expect(host(page)).toHaveAttribute('data-kind-cue', 'Heading level 1');
		await expect(announcer(page)).toHaveText('Heading level 1');
	});

	test('an undo inside the fade takes the heading cue off the paragraph', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await atStartOfFirst(ep, page);
		await page.keyboard.type('# ');
		await ep.bridge.waitForSourceEquals('# notes\n');
		await expect(host(page)).toHaveAttribute('data-kind-cue', 'Heading level 1');

		await ep.undo();
		await ep.bridge.waitForSourceEquals('notes\n');
		await ep.waitForRenderFlush();

		// Read once, well inside the fade: a retrying assertion would pass when the fade ends.
		expect(await host(page).getAttribute('data-kind-cue')).toBeNull();
	});

	test('the same keystrokes in source mode show no cue', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'source', DOC);
		await atStartOfFirst(ep, page);

		await page.keyboard.type('# ');
		await ep.bridge.waitForSourceEquals('# notes\n');

		await expect(host(page)).not.toHaveAttribute('data-kind-cue');
		await expect(announcer(page)).toHaveText('');
	});

	test('a command that changes the kind shows no cue', async ({ page }) => {
		const ep = await enterPresentationMode(page, 'live', DOC);
		await atStartOfFirst(ep, page);

		await page.keyboard.press('ControlOrMeta+2');
		await ep.bridge.waitForSourceEquals('## notes\n');

		expect(await ep.bridge.getBlockKind(0)).toBe('heading');
		await expect(host(page)).not.toHaveAttribute('data-kind-cue');
		await expect(announcer(page)).toHaveText('');
	});
});

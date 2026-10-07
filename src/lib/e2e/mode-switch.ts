// How a spec switches the editor's presentation mode by clicking. Each switch waits for the mode to
// show on the editor root: a mode that never applies leaves source, where most assertions pass too.
import { expect, type Locator, type Page } from '@playwright/test';
import type { PresentationMode } from '../presentation-mode';

/** The header checkboxes on `/test/editor` (`/test/plugins` has the reading one). */
const MODE_TOGGLE_TESTIDS = {
	reading: 'presentation-toggle',
	'preview-block': 'preview-block-toggle',
	'preview-inline': 'preview-inline-toggle',
	live: 'live-toggle'
} as const satisfies Record<Exclude<PresentationMode, 'source'>, string>;

export type ToggledMode = keyof typeof MODE_TOGGLE_TESTIDS;

export async function expectPresentationMode(root: Locator, mode: PresentationMode): Promise<void> {
	if (mode === 'source') await expect(root).not.toHaveAttribute('data-presentation');
	else await expect(root).toHaveAttribute('data-presentation', mode);
}

/** Clicks the header checkbox for `mode`, which switches between `mode` and source, and returns the
 *  mode it switched to once the editor shows it. */
export async function clickModeToggle(page: Page, mode: ToggledMode): Promise<PresentationMode> {
	const root = page.locator('.editor');
	const applied = (await root.getAttribute('data-presentation')) === mode ? 'source' : mode;
	await page.getByTestId(MODE_TOGGLE_TESTIDS[mode]).click();
	await expectPresentationMode(root, applied);
	return applied;
}

/** Clicks the showcase's or the changelog's button for `mode`, which sets that mode outright. */
export async function clickModeButton(page: Page, mode: PresentationMode): Promise<void> {
	await page.locator(`:is(.showcase-mode, .changelog-mode)[data-mode="${mode}"]`).click();
	await expectPresentationMode(page.locator('.editor'), mode);
}

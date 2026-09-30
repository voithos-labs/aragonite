import { type Page } from '@playwright/test';

/** The one place that asks which browser is running: the clipboard helper and the IME driver
 *  both branch on it. */
export function isWebKit(page: Page): boolean {
	return page.context().browser()?.browserType().name() === 'webkit';
}

import { type Page } from '@playwright/test';

/** One home for the engine read: the clipboard arm and the IME driver both branch on it. */
export function isWebKit(page: Page): boolean {
	return page.context().browser()?.browserType().name() === 'webkit';
}

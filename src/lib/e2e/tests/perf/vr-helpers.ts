import { type Page } from '@playwright/test';

// Shared probes for the virtual-rendering (top-level windowing) e2e suites. Every
// fixture in these suites clears the editor's height watermark, so only a window of
// blocks mounts and the off-window reveal path runs for real. Honest assertions
// only — a reveal that doesn't land the caret is a VR bug to report, not an
// assertion to soften.

export const FIXTURE_BYTES = 2_000_000;

export function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

export function spacerCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

export function capturePageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

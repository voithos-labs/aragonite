import { type Page } from '@playwright/test';

// Page-level probes shared across the e2e suites. Collecting a pageerror stream stays a
// per-spec assertion decision: this module hands over the collector, never an auto-assertion.

// Start collecting uncaught page errors and return the growing array. Pair with an
// explicit `expect(pageErrors).toEqual([])` where the spec asserts error-freedom.
export function capturePageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

// Demo routes SSR their editor, so painted blocks prove nothing about handlers: a click
// landing before hydration silently reaches none. `trackParityDocument` registers from a
// client-only effect, so its arrival is the barrier. Bridge-less routes have no other one.
export function waitForEditorHydrated(page: Page): Promise<unknown> {
	return page.waitForFunction(
		() => ((window as { __parityDocuments?: unknown[] }).__parityDocuments ?? []).length > 0
	);
}

// Whether the top-level block at `index` has a mounted host — false once windowing
// unmounts it. Windowing-generic, so it serves both the VR reveal specs and the
// off-window selection-skip specs.
export function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

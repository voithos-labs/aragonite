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

// A fixed instant rather than the wall clock (G4.48), advanced one second so a timer armed
// during setup settles before the page stops ticking.
const FROZEN_AT = new Date('2026-01-01T00:00:00Z');
const FROZEN_UNTIL = new Date('2026-01-01T00:00:01Z');

// Stop every in-page timer, so a spec owns when the editor's typing pause elapses.
// `install` alone leaves the fake clock ticking; only the pause stops timers, and
// Playwright's own retries keep running on the runner's real clock. Install it after the
// setup gestures: the harness's render-flush waits ride rAF, which a frozen page never runs.
export async function freezeInPageClock(page: Page): Promise<void> {
	await page.clock.install({ time: FROZEN_AT });
	await page.clock.pauseAt(FROZEN_UNTIL);
}

/** Advance a frozen clock by this to elapse the editor's 250 ms typing pause. */
export const PAST_TYPING_PAUSE_MS = 300;

// Whether the top-level block at `index` has a mounted host — false once windowing
// unmounts it. Windowing-generic, so it serves both the VR reveal specs and the
// off-window selection-skip specs.
export function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

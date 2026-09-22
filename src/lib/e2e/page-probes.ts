import { type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';

// Page-level probes shared across the e2e suites. Collecting page errors stays each spec's
// decision: this module hands back the collected list and never asserts on it.

// Starts collecting uncaught page errors and returns the growing array. Pair it with an
// explicit `expect(pageErrors).toEqual([])` where the spec asserts there were none.
export function capturePageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

/** What a page reported while it loaded: uncaught errors first, then console errors, then one
 *  line per request that failed. `seen` reads what has arrived; `stop` detaches the listeners. */
export interface PageFailures {
	seen(): string[];
	stop(): void;
}

// Attach before navigating: a wait that runs out can then say what the page reported instead of
// only that it waited.
export function watchPageFailures(page: Page): PageFailures {
	const uncaught: string[] = [];
	const logged = new Set<string>();
	const byUrl = new Map<string, string>();
	const onConsole = (m: ConsoleMessage) => {
		// Chromium logs this line for every bad response, and `byUrl` already names the URL.
		if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
		logged.add(`console error: ${m.text()}`);
	};
	const onPageError = (e: Error) => uncaught.push(`page error: ${e.message}`);
	const onRequestFailed = (r: Request) => {
		const reason = r.failure()?.errorText ?? 'no reason given';
		if (!byUrl.has(r.url())) byUrl.set(r.url(), `request failed: ${r.url()} (${reason})`);
	};
	const onResponse = (r: Response) => {
		if (r.status() >= 400 && !byUrl.has(r.url())) {
			byUrl.set(r.url(), `response ${r.status()}: ${r.url()}`);
		}
	};
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	page.on('requestfailed', onRequestFailed);
	page.on('response', onResponse);
	return {
		seen: () => [...uncaught, ...logged, ...byUrl.values()],
		stop() {
			page.off('console', onConsole);
			page.off('pageerror', onPageError);
			page.off('requestfailed', onRequestFailed);
			page.off('response', onResponse);
		}
	};
}

// Demo routes render their editor on the server, so blocks on screen prove nothing about
// handlers: a click before hydration reaches none of them. `trackParityDocument` registers from
// a client-only effect, so its arrival is the signal, and a route without the test bridge has
// no other.
export function waitForEditorHydrated(page: Page): Promise<unknown> {
	return page.waitForFunction(
		() => ((window as { __parityDocuments?: unknown[] }).__parityDocuments ?? []).length > 0
	);
}

// A fixed instant rather than the wall clock (G4.48), advanced one second so a timer set during
// setup fires before the page stops ticking.
const FROZEN_AT = new Date('2026-01-01T00:00:00Z');
const FROZEN_UNTIL = new Date('2026-01-01T00:00:01Z');

// Stops every in-page timer, so a spec decides when the editor's typing pause elapses.
// `install` alone leaves the fake clock ticking; only pausing it stops timers, and Playwright's
// own retries keep running on the runner's real clock. Call it after the setup gestures: the
// harness's render waits ride rAF, which a frozen page never runs.
export async function freezeInPageClock(page: Page): Promise<void> {
	await page.clock.install({ time: FROZEN_AT });
	await page.clock.pauseAt(FROZEN_UNTIL);
}

/** Advance a frozen clock by this to elapse the editor's 250 ms typing pause. */
export const PAST_TYPING_PAUSE_MS = 300;

// Whether the top-level block at `index` has a mounted host: false once windowing unmounts it.
export function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

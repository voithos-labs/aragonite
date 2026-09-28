import type { ConsoleMessage, Page } from '@playwright/test';
import { watchPageFailures } from './page-probes';

// Every e2e navigation, so a spec acts only on a hydrated route: a server-rendered route paints
// its markup before any handler attaches, and only the route's readiness global says they have.

/** The global a test route assigns from a client-only effect once its editors mounted. */
export type ReadyGlobal =
	| '__test'
	| '__parityDocuments'
	| '__activation'
	| '__syntax'
	| '__editorsReady'
	| '__flow'
	| '__pageScroll';

/** A ceiling, since a full battery on one dev server slows hydration; it stays under Playwright's
 *  test timeout so a miss reports what the page did (`lint/harness-timeout-headroom.test.ts`). */
export const READY_TIMEOUT = 45_000;

export function gotoReady(page: Page, url: string, ready: ReadyGlobal): Promise<void> {
	return navigateReady(page, url, ready, (timeout) => page.goto(url, { timeout }));
}

export function reloadReady(page: Page, ready: ReadyGlobal): Promise<void> {
	return navigateReady(page, page.url(), ready, (timeout) => page.reload({ timeout }));
}

async function navigateReady(
	page: Page,
	url: string,
	ready: ReadyGlobal,
	navigate: (timeout: number) => Promise<unknown>
): Promise<void> {
	const failures = watchPageFailures(page);
	const loadSteps = watchLoadSteps(page);
	// The navigation, the mount and the global share one budget: a full ceiling each would sum
	// past the runner's timeout, and a wait killed by the runner reports none of this.
	const deadline = Date.now() + READY_TIMEOUT;
	// Playwright reads 0 as "no timeout", so an exhausted budget asks for the smallest wait.
	const budgetLeft = () => Math.max(1, deadline - Date.now());
	const diagnose = async (what: string, cause: unknown): Promise<never> => {
		const reported = failures.seen();
		// Playwright's own message is what separates a timeout from a context destroyed by a
		// reload, which is the other way the global goes missing.
		throw new Error(
			[
				`${url}: ${what} in ${READY_TIMEOUT} ms (${firstLine(cause)}).`,
				'The page reported:',
				...(reported.length > 0 ? reported : ['nothing captured']),
				'Its loads and dev-client lines:',
				...loadSteps.seen(),
				await probeDevServer(page)
			].join('\n')
		);
	};
	try {
		await navigate(budgetLeft()).catch((cause) => diagnose('the page never loaded', cause));
		await page
			.locator('.editor')
			.first()
			.waitFor({ state: 'visible', timeout: budgetLeft() })
			.catch((cause) => diagnose('no editor ever mounted', cause));
		await page
			.waitForFunction((name) => (window as any)[name] !== undefined, ready, {
				timeout: budgetLeft()
			})
			.catch((cause) => diagnose(`an editor mounted but window.${ready} never arrived`, cause));
		// The routes paint a webfont; a caret measured before it arrives is placed by the
		// fallback font's metrics, and the block reflows under the spec.
		await page.evaluate(() => document.fonts.ready);
	} finally {
		failures.stop();
		loadSteps.stop();
	}
}

// ── Page-load diagnosis ─────────────────────────────────────────────

/** Each document the page loaded and each line Vite's client logged, timed from the call: a
 *  reload after Vite re-bundles its dependencies shows as a second load. */
function watchLoadSteps(page: Page): { seen(): string[]; stop(): void } {
	const started = Date.now();
	const steps: string[] = [];
	const at = () => `+${Date.now() - started} ms`;
	const onLoaded = () => steps.push(`${at()} document loaded: ${page.url()}`);
	const onConsole = (m: ConsoleMessage) => {
		if (m.text().startsWith('[vite]')) steps.push(`${at()} ${m.text()}`);
	};
	page.on('domcontentloaded', onLoaded);
	page.on('console', onConsole);
	return {
		seen: () => (steps.length > 0 ? steps : ['none captured']),
		stop() {
			page.off('domcontentloaded', onLoaded);
			page.off('console', onConsole);
		}
	};
}

/** Whether the dev server still answers, asked from the test process: the server's own output
 *  goes to the runner's reporters, which a worker cannot read. */
async function probeDevServer(page: Page): Promise<string> {
	const started = Date.now();
	try {
		const response = await page.request.get('/favicon.svg', { timeout: 5_000 });
		return `The dev server answered /favicon.svg with ${response.status()} in ${Date.now() - started} ms.`;
	} catch (error) {
		return `The dev server did not answer /favicon.svg: ${firstLine(error)}`;
	}
}

function firstLine(error: unknown): string {
	return String(error).split('\n')[0];
}

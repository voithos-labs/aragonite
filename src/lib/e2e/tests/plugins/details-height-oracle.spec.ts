import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import {
	DetailsPage,
	readDetails,
	capturedErrors,
	auditRealDesyncs,
	editorScrollHeight,
	scrollThrough
} from './details-helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * Spec §8.3 — height-oracle estimate for collapsed containers. The oracle reads the declared
 * `reservedChrome.isCollapsed` probe and estimates a collapsed details at one chrome row, ignoring
 * the hidden body its `raw` still carries. The unit suite pins the exact estimate; this proves it
 * at scale — the load-time height no longer over-counts — and stays correct under the residual
 * under-estimate the scroll-anchor machinery absorbs.
 */

function collapsedDetailsDoc(count: number): string {
	return (
		Array.from({ length: count }, (_, i) => {
			const body =
				`Paragraph A of details ${i}. ` +
				'lorem ipsum dolor sit amet '.repeat(20) +
				'\n\n' +
				`Paragraph B of details ${i}. ` +
				'consectetur adipiscing elit '.repeat(20);
			return `<details>\n<summary>Summary ${i}</summary>\n\n${body}\n\n</details>`;
		}).join('\n\n') + '\n'
	);
}

// Large enough that even the tight one-chrome-row estimate (~40px each) exceeds
// the mounted band — the precondition below needs off-window rows to exist.
const COUNT = 300;

function topLevelSpacerCount(page: Page): Promise<number> {
	// Collapsed details mount no body, so every `.vr-spacer` is a top-level one.
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

function topLevelHostCount(page: Page): Promise<number> {
	return page.evaluate(
		() => document.querySelectorAll('[data-block-path]:not([data-block-path*=","])').length
	);
}

test.describe('plugin container: <details> collapsed height estimate at scale', () => {
	let editor: DetailsPage;
	let pageErrors: string[];

	test.beforeEach(async ({ page }) => {
		editor = new DetailsPage(page);
		pageErrors = capturePageErrors(page);
		await editor.gotoDetails();
	});

	test.afterEach(() => {
		expect(pageErrors).toEqual([]);
	});

	test('a run of collapsed details estimates one chrome row each, not the hidden body', async ({
		page
	}) => {
		await editor.loadContent(collapsedDetailsDoc(COUNT));
		expect((await readDetails(page, 0)).rootCount).toBe(COUNT);
		expect((await readDetails(page, 0)).kind).toBe('details');
		expect((await editor.bridge.getSource()).includes('<details open>')).toBe(false);

		// Precondition: top-level windowing is active and most details are off-window
		// (estimated from the collapse probe), or the comparison below is vacuous.
		expect(await topLevelSpacerCount(page)).toBeGreaterThan(0);
		expect(await topLevelHostCount(page)).toBeLessThan(COUNT);

		const estimated = await editorScrollHeight(page);
		await scrollThrough(page, editor);
		const measured = await editorScrollHeight(page);

		const drift = estimated - measured;
		const perDetails = drift / COUNT;
		// A meter, not a gate: the assertion below pins only the direction, so the magnitude is
		// reported for the run log rather than bounded.
		console.log(
			`details collapsed-estimate drift ${JSON.stringify({ estimated, measured, drift, perDetails })}`
		);

		// The direction is the assertion: an under-estimate is absorbed, an over-count is not.
		expect(estimated).toBeLessThan(measured);

		// Correctness holds under the residual drift: no desync, no render throw.
		expect(await auditRealDesyncs(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

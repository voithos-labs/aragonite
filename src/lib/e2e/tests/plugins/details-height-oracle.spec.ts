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
 * How a collapsed container's height is estimated (`virtual-rendering.md` § How tall is a block
 * nobody has rendered?). The `heightOracle` (estimates block heights) reads the declared
 * `reservedChrome.isCollapsed` check and estimates a collapsed details at one title row, ignoring
 * the hidden body its `raw` still holds. The unit suite pins the exact number; this proves it at
 * scale, so the load-time height does not over-count, and stays correct under the small
 * under-estimate that holding a block in place on screen absorbs.
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

// Large enough that even the tight one-title-row estimate of about 40px each runs past the
// mounted range, since the precondition below needs rows that stay unmounted.
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

		// Precondition: top-level windowing is active and most of the details are unmounted, their
		// heights estimated from the collapse check, or the comparison below proves nothing.
		expect(await topLevelSpacerCount(page)).toBeGreaterThan(0);
		expect(await topLevelHostCount(page)).toBeLessThan(COUNT);

		const estimated = await editorScrollHeight(page);
		await scrollThrough(page, editor);
		const measured = await editorScrollHeight(page);

		const drift = estimated - measured;
		const perDetails = drift / COUNT;
		// Reported, not asserted: the assertion below pins only the direction, so the size of the
		// difference goes to the run log rather than into a bound.
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

/**
 * The navigation's wait for a route's readiness global has to run out before Playwright's own test
 * timeout, or the runner kills the test first and a missing global reports the bare runner line
 * instead of what the page did.
 * Miss-analysis: no test held the harness wait's ceiling under the runner's timeout.
 */
import { describe, it, expect } from 'vitest';
import config from '../../../../playwright.config';
import { READY_TIMEOUT } from '../goto-ready';

/** What the budget does not cover: the clipboard install before the navigation, and Playwright
 *  carrying the throw into the report before it declares the test dead. */
const REPORTING_MARGIN = 10_000;

describe('the harness budget runs out before the runner gives up', () => {
	it('leaves the runner room to report what the page did', () => {
		expect(config.timeout).toBeGreaterThanOrEqual(READY_TIMEOUT + REPORTING_MARGIN);
	});
});

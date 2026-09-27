/**
 * The harness's wait for `window.__test` has to run out before Playwright's own test timeout, or
 * the runner kills the test first and a missing bridge reports the bare runner line instead of
 * what the page did.
 * Miss-analysis: no test held the harness wait's ceiling under the runner's timeout.
 */
import { describe, it, expect } from 'vitest';
import config from '../../../../playwright.config';
import { BRIDGE_INSTALL_TIMEOUT } from '../editor-page';

/** What the budget does not cover: the clipboard install before the navigation, and Playwright
 *  carrying the throw into the report before it declares the test dead. */
const REPORTING_MARGIN = 10_000;

describe('the harness budget runs out before the runner gives up', () => {
	it('leaves the runner room to report what the page did', () => {
		expect(config.timeout).toBeGreaterThanOrEqual(BRIDGE_INSTALL_TIMEOUT + REPORTING_MARGIN);
	});
});

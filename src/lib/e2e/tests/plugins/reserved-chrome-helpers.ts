import { type Page } from '@playwright/test';

// Suite-specific probes for the Fork-A `:::note` reserved-chrome e2e suites
// (selection parity, reserved-index structural ops, the rangeDelete wall, and the
// wall × table branch). The shared page/read/error probes come from ./helpers;
// this module adds the state-consistency audit and the titled-callout fixture.
// Every gate reads the CST/selection by path via `window.__test`, never visuals.

export { PluginsPage, activeBlockPath, capturedErrors, readContainer as readNote } from './helpers';

export async function stateConsistencyViolations(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__test.auditBlockListStateConsistency());
}

// Paragraph above + a titled callout. Top-level: [0]=para "Above",
// [1]=callout; callout children: [1,0]=title "Title", [1,1]=para "Body".
export const FIXTURE = 'Above\n\n:::note Title\nBody\n:::\n';

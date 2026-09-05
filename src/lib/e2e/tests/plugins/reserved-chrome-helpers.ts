import { type Page } from '@playwright/test';

// Suite-specific probes for the `:::callout` reserved-chrome e2e suites (selection parity,
// reserved-index structural ops, the rangeDelete wall, and the wall × table branch). The shared
// page/read/error probes come from ./helpers; this module adds the state-consistency audit and the
// titled-callout fixture.

export {
	PluginsPage,
	activeBlockPath,
	capturedErrors,
	dragBetweenPoints,
	readContainer as readCallout
} from './helpers';

export async function stateConsistencyViolations(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__test.auditBlockListStateConsistency());
}

// Paragraph above + a titled callout. Top-level: [0]=para "Above",
// [1]=callout; callout children: [1,0]=title "Title", [1,1]=para "Body".
export const FIXTURE = 'Above\n\n:::callout Title\nBody\n:::\n';

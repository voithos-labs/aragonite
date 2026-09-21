import { type Page } from '@playwright/test';

// Reads for the `:::callout` suites about its editable title row: matching selection behaviour,
// structural edits at the title's index, the boundary rangeDelete stops at, and that boundary in a
// table. The shared page, read and error helpers come from ./helpers; this module adds the
// consistency audit and the titled-callout fixture.

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

// A paragraph above a titled callout. At the top level [0] is the paragraph "Above" and [1] the
// callout; inside it, [1,0] is the title "Title" and [1,1] the paragraph "Body".
export const FIXTURE = 'Above\n\n:::callout Title\nBody\n:::\n';

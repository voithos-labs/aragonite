import { beforeEach, describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { declaredPluginKind } from '$lib/plugin';
import { resetPluginPlatformForTests, runKindConformance } from '$lib/testing';
import { footnotesPlugin, FOOTNOTE_DEF_KIND } from '$lib/plugins/footnotes';

const ALL_COLUMNS = [
	'roundTrip',
	'focus',
	'mergeBackspace',
	'selectionPaint',
	'searchPaint',
	'reorder',
	'undo',
	'clipboard',
	'simOracle'
];

describe('footnote definition conformance', () => {
	beforeEach(() => {
		resetPluginPlatformForTests();
		installPlugins([footnotesPlugin()]);
	});

	it('answers every closure column now that it is a container with real children', async () => {
		const report = await runKindConformance(declaredPluginKind(FOOTNOTE_DEF_KIND));
		expect(report.cells.map((c) => c.column).sort()).toEqual([...ALL_COLUMNS].sort());
	});

	// The two cells that would regress if the strip container broke. A `boundary` on
	// roundTrip means the fixture stopped parsing to the kind, not that it passed.
	it('executes the round-trip and merge cells rather than deferring them', async () => {
		const { cells } = await runKindConformance(declaredPluginKind(FOOTNOTE_DEF_KIND));
		const roundTrip = cells.find((c) => c.column === 'roundTrip')!;
		expect(roundTrip.status).toBe('executed');
		expect(roundTrip.detail).toContain('rebuildRaw parse-identity');

		const merge = cells.find((c) => c.column === 'mergeBackspace')!;
		expect(merge.status).toBe('executed');
		expect(merge.mode).toBe('implemented');
	});
});

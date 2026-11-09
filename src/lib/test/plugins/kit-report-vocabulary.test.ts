// @vitest-environment jsdom
// The three conformance kits report a cell in one shape, so one reader handles all their reports.
import { describe, expect, it } from 'vitest';
import { installPlugins } from '#lib';
import { declaredPluginInlineKind, INLINE_PRIORITIES } from '#lib/plugin.js';
import {
	runContainerConformance,
	runInlineKindConformance,
	runKindConformance,
	type CellReport
} from '#lib/testing.js';
import { emojiPlugin, EMOJI_KIND } from '#packages/emoji/src/index.js';

const STATUSES = ['asserted', 'exempt', 'boundary'];
const EXCUSED = 'the vocabulary suite reads the report shape, not what this cell would prove';

function expectVocabulary(cells: readonly CellReport[]): void {
	for (const report of cells) {
		for (const key of Object.keys(report)) {
			expect(['cell', 'status', 'detail'], JSON.stringify(report)).toContain(key);
		}
		expect(STATUSES).toContain(report.status);
	}
}

describe('conformance kit reports share one vocabulary', () => {
	it('the container kit reports an excuse as its detail', async () => {
		const { cells } = await runContainerConformance('blockquote', {
			deepNesting: { source: '> a\n>\n> > b\n', leafPath: [0, 1, 0] },
			focusSource: '> a\n>\n> b\n',
			localIndex: { mode: 'exempt', reason: EXCUSED },
			ancestry: { mode: 'exempt', reason: EXCUSED },
			multiScope: { mode: 'exempt', reason: EXCUSED },
			focusBubble: { mode: 'assert' },
			terminatorCollision: { mode: 'exempt', reason: EXCUSED }
		});
		expectVocabulary(cells);
		expect(cells.find((c) => c.cell === 'multiScope')).toEqual({
			cell: 'multiScope',
			status: 'exempt',
			detail: EXCUSED
		});
	});

	it('the kind kit reports raw-write as a cell like the rest', async () => {
		const { cells } = await runKindConformance('fencedCode');
		expectVocabulary(cells);
		expect(cells.find((c) => c.cell === 'rawWrite')?.status).toBe('asserted');
	});

	it('the inline kit resolves its report like the other two', async () => {
		installPlugins([emojiPlugin()]);
		const pending = runInlineKindConformance({
			trigger: ':',
			priority: INLINE_PRIORITIES.plugin + 10,
			kind: declaredPluginInlineKind(EMOJI_KIND),
			fixtures: [':smile:'],
			overlapFixtures: ['meet at 10:30'],
			overlapDecline: { mode: 'assert' },
			widget: { mode: 'assert' },
			editingPolicy: { mode: 'assert' },
			imageClaim: { mode: 'exempt', reason: EXCUSED }
		});
		expect(pending).toBeInstanceOf(Promise);
		expectVocabulary((await pending).cells);
	});
});

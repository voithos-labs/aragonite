// A dev check that would do more with a DOM says so when a test file without jsdom reaches it,
// instead of passing with its DOM half skipped. Miss: every test of the inline kit's widget cell
// ran under jsdom, so none saw the no-DOM branch report a quiet `boundary`.
import { describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { declaredPluginInlineKind, INLINE_PRIORITIES } from '$lib/plugin';
import { runInlineKindConformance } from '$lib/testing';
import { emojiPlugin, EMOJI_KIND } from '$lib/plugins/emoji';
import { takeDevWarns } from '../support/warn-gate';

const EXCUSED = 'this suite reaches the widget cell only';

describe('a dev check with no DOM to read reports that it did not run', () => {
	it('the inline kit’s widget cell, for a kind that builds its own widget', async () => {
		expect(typeof document).toBe('undefined');
		installPlugins([emojiPlugin()]);
		const report = await runInlineKindConformance({
			trigger: ':',
			priority: INLINE_PRIORITIES.plugin + 10,
			kind: declaredPluginInlineKind(EMOJI_KIND),
			fixtures: [':smile:'],
			overlapFixtures: [],
			overlapDecline: { mode: 'exempt', reason: EXCUSED },
			widget: { mode: 'assert' },
			editingPolicy: { mode: 'assert' },
			imageClaim: { mode: 'exempt', reason: EXCUSED }
		});
		expect(report.cells.find((c) => c.cell === 'widget')?.status).toBe('boundary');
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['needs-dom']);
	});
});

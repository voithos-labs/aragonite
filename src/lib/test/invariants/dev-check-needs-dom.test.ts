// A dev check that reads the DOM says so when a test file without jsdom reaches it, instead of
// passing with the check switched off. Miss: every test of these checks ran under jsdom, so none
// saw the no-DOM branch return quietly.
import { describe, expect, it } from 'vitest';
import { installPlugins } from '$lib';
import { declaredPluginInlineKind, INLINE_PRIORITIES } from '$lib/plugin';
import { runInlineKindConformance } from '$lib/testing';
import { emojiPlugin, EMOJI_KIND } from '$lib/plugins/emoji';
import type { StructuralChange } from '$lib/tree-operations/structural-change';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { asDocPath } from '$lib/selection/path-math';
import { makeTopHarness } from '../harness/editor-actions';
import { takeDevWarns } from '../support/warn-gate';

const EXCUSED = 'this suite reaches the widget cell only';

const deleteSecond = (children: unknown[]): StructuralChange => {
	children.splice(1, 1);
	return { op: 'delete', at: 1, count: 1 };
};

const ROUTES: [name: string, reach: () => Promise<unknown>][] = [
	[
		'the landing check, through a commit that reads its landing',
		() =>
			makeTopHarness('a\n\nb\n\nc\n').controller.commitStructural({
				snapshot: { path: asDocPath([0]), offset: 0 },
				mutate: deleteSecond,
				landing: () => ({ path: docPathFrom([0]), offset: 0 })
			})
	],
	[
		'the inline kit’s widget cell, for a kind that builds its own widget',
		() => {
			installPlugins([emojiPlugin()]);
			return runInlineKindConformance({
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
		}
	]
];

describe('a dev check with no DOM to read reports that it did not run', () => {
	it.each(ROUTES)('%s', async (_name, reach) => {
		expect(typeof document).toBe('undefined');
		await reach();
		expect(takeDevWarns().map((w) => w.tag)).toEqual(['needs-dom']);
	});
});

// A watch's answers change when one that says something leaves its index, and only then.
// Miss-analysis: the rows held the answers' order, never their index, so an Enter above a heading
// left a drawing's answers a block off.
import { describe, expect, it } from 'vitest';
import { watchKeys } from '#lib/editor-actions/commit/block-keys.js';
import type { WriteFollower } from '#lib/editor-actions/commit/kept-starts.js';
import type { TopLevelChange } from '#lib/tree-operations/top-level-starts.js';
import type { Block } from '#lib/schema/doc-view.js';

/** A document of top-level blocks as their texts, with the writes a watch follows. */
function document(texts: string[]) {
	let blocks = texts;
	const followers: WriteFollower[] = [];
	return {
		followers,
		blocks: () => blocks.map((text) => ({ text }) as unknown as Block),
		/** Writes `inserted` over `removed` blocks at `at`, announced as one run. */
		write(at: number, removed: number, inserted: string[] = []) {
			blocks = [...blocks.slice(0, at), ...inserted, ...blocks.slice(at + removed)];
			const runs: TopLevelChange[] = [{ at, removed, inserted: inserted.length }];
			for (const follower of followers.slice()) follower.heard({ runs, before: null });
		},
		follow(follower: WriteFollower) {
			followers.push(follower);
			return () => void followers.splice(followers.indexOf(follower), 1);
		}
	};
}

const headings = (block: Block) => (block.text.startsWith('#') ? block.text : '');
const watched = (texts: string[]) => {
	const doc = document(texts);
	return { doc, watch: watchKeys(doc, headings, () => {}) };
};

describe('its answers change', () => {
	const ROWS: [string, number, number, string[], boolean][] = [
		['a block put in ahead of an answer', 1, 0, ['q'], true],
		['a block taken out ahead of an answer', 1, 1, [], true],
		['a block put in past the last answer', 3, 0, ['q'], false],
		['a block taken out past the last answer', 3, 1, [], false],
		['a heading split at its end, the new block saying nothing', 2, 1, ['# B', ''], false],
		['a heading split at its start', 2, 1, ['', '# B'], true]
	];
	it.each(ROWS)('%s', (_name, at, removed, inserted, changes) => {
		const { doc, watch } = watched(['# A', 'p', '# B', 'tail']);
		const was = watch.version();
		doc.write(at, removed, inserted);
		expect(watch.version() !== was).toBe(changes);
		expect(watch.keys()).toEqual(doc.blocks().map(headings));
	});
});

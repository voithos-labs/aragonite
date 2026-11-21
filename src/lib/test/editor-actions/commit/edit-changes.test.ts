// What a write's `changes` say on the shapes no write route reaches: the last block rewritten
// outside the runs, the bytes around the blocks changed, and a load heard before an edit.
// Miss-analysis: a new module; its edge branches mirror the kept record's own and had no row.
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import type { DocumentView } from '#lib/core/node-views.js';
import type { Change } from '#lib/editor-events.js';
import { blockBytes, type TopLevelChange } from '#lib/tree-operations/top-level-starts.js';
import { createEditChanges } from '#lib/editor-actions/commit/edit-changes.js';

const applied = (text: string, changes: readonly Change[]) =>
	[...changes]
		.reverse()
		.reduce((out, c) => out.slice(0, c.from) + c.insert + out.slice(c.to), text);

/** The changes a listener reads for the writes from `texts[0]` through the rest, each with its runs. */
function changesOver(texts: string[], runs: (readonly TopLevelChange[] | null)[]) {
	const changes = createEditChanges();
	changes.listen();
	let before = parse(texts[0], { scope: 'document' }) as DocumentView;
	for (let i = 1; i < texts.length; i++) {
		const after = parse(texts[i], { scope: 'document' }) as DocumentView;
		changes.heard({ runs: runs[i - 1], before: blockBytes(before.children) }, after);
		before = after;
	}
	return changes.take(() => texts[texts.length - 1])();
}

describe('edit.changes', () => {
	it("carries the last block's rewrite where no run took it", () => {
		const [was, now] = ['a\n\nb\n\nlast', 'a!\n\nb\n\nlast\n'];
		const changes = changesOver([was, now], [[{ at: 0, removed: 1, inserted: 1 }]]);
		expect(changes).toHaveLength(2);
		expect(applied(was, changes)).toBe(now);
	});

	it('is the whole text where a write could not say what it changed', () => {
		expect(changesOver(['a\n\nb\n', 'c\n'], [null])).toEqual([{ from: 0, to: 5, insert: 'c\n' }]);
	});

	it('spans two writes heard before one edit with one change over both', () => {
		const texts = [
			'a\n\nb\n\nc\n\nd\n\ne\n',
			'a\n\nB!\n\nc\n\nd\n\ne\n',
			'a\n\nB!\n\nc\n\nDD\n\ne\n'
		];
		const one = { at: 1, removed: 1, inserted: 1 };
		const changes = changesOver(texts, [[one], [{ ...one, at: 3 }]]);
		expect(changes).toHaveLength(1);
		expect(applied(texts[0], changes)).toBe(texts[2]);
	});

	it('starts over at a load heard before the edit', () => {
		const texts = ['old\n', 'new\n\ntext\n', 'newer\n\ntext\n'];
		const changes = changesOver(texts, [null, [{ at: 0, removed: 1, inserted: 1 }]]);
		expect(applied(texts[1], changes)).toBe(texts[2]);
	});
});

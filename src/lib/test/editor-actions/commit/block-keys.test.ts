// A watch nobody reads lets go of the writes after 64 of them and asks every block when it's read
// again; a nullish answer says nothing; the answers change when one that says something leaves
// its index, and only then, after any writes.
// Miss-analysis: a follower kept alive asks nothing, so no counter row saw a watch never let go.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { watchKeys } from '#lib/editor-actions/commit/block-keys.js';
import type { WriteFollower } from '#lib/editor-actions/commit/kept-starts.js';
import type { TopLevelChange } from '#lib/tree-operations/top-level-starts.js';
import type { Block } from '#lib/schema/doc-view.js';
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/index.js';

interface Run {
	at: number;
	removed: number;
	inserted: string[];
}

/** A document of top-level blocks as their texts, with the writes a watch follows. */
function document(texts: string[]) {
	let blocks = texts;
	let definitions = {};
	const followers: WriteFollower[] = [];
	return {
		followers,
		definitions: () => definitions,
		/** A write that changes a link reference definition, a block's bytes left alone. */
		redefine() {
			definitions = {};
			this.writeRuns([]);
		},
		blocks: () => blocks.map((text) => ({ text }) as unknown as Block),
		count: () => blocks.length,
		block: (i: number) => ({ text: blocks[i] }) as unknown as Block,
		/** Writes `inserted` over `removed` blocks at `at`, announced as one run. */
		write(at: number, removed: number, inserted: string[] = []) {
			this.writeRuns([{ at, removed, inserted }]);
		},
		/** One write of several runs, in document order, each `at` counted before the write;
		 *  `named` false announces it as a write that can't say what it changed. */
		writeRuns(runs: Run[], named = true) {
			const next: string[] = [];
			let from = 0;
			for (const run of runs) {
				next.push(...blocks.slice(from, run.at), ...run.inserted);
				from = run.at + run.removed;
			}
			blocks = next.concat(blocks.slice(from));
			const told: TopLevelChange[] | null = named
				? runs.map((run) => ({ at: run.at, removed: run.removed, inserted: run.inserted.length }))
				: null;
			for (const follower of followers.slice()) follower.heard({ runs: told, before: null });
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

describe('a watch nobody reads', () => {
	it('follows 64 writes, lets go at the 65th, and reads again as a fresh evaluation', () => {
		const { doc, watch } = watched(['# A', 'p', '# B']);
		for (let i = 0; i < 64; i++) doc.write(1, 1, [`p${i}`]);
		expect(doc.followers.length).toBe(1);
		doc.write(1, 1, ['# New']);
		expect(doc.followers.length).toBe(0);
		expect(watch.keys()).toEqual(['# A', '# New', '# B']);
		expect(doc.followers.length).toBe(1);
	});

	// Miss-analysis: the row above reads a document that still says something; none had a reader
	// come back to a watch that let go, with every answer it held gone.
	it('tells a reader that comes back a change, though no block says anything by then', () => {
		const { doc, watch } = watched(['# A', 'p']);
		const seen = watch.version();
		for (let i = 0; i < 65; i++) doc.write(1, 1, [`p${i}`]);
		doc.write(0, 1, ['a']);
		expect(watch.version()).not.toBe(seen);
		expect(watch.keys()).toEqual(['', '']);
	});
});

describe('an answer', () => {
	it('that is nullish says nothing', () => {
		const doc = document(['# A', 'p']);
		const nothing = (block: Block) => (block.text.startsWith('#') ? block.text : undefined);
		const watch = watchKeys(doc, nothing as (block: Block) => string, () => {});
		expect(watch.keys()).toEqual(['# A', '']);
	});
});

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

// Miss-analysis: every row wrote the blocks it asked about, so none changed a definition alone,
// which a heading's reference link reads from another block.
describe('a change to the link reference definitions', () => {
	it('asks every block again, though no block was written', () => {
		let defined = 'p';
		const doc = document(['# A', 'tail']);
		const linked = (block: Block) => (block.text.startsWith('#') ? `${block.text} ${defined}` : '');
		const watch = watchKeys(doc, linked, () => {});
		expect(watch.keys()).toEqual(['# A p', '']);
		const was = watch.version();
		defined = 'q';
		doc.redefine();
		expect(watch.keys()).toEqual(['# A q', '']);
		expect(watch.version()).not.toBe(was);
	});
});

// ── Any writes ───────────────────────────────────────────────────────────────

const TEXT = fc.constantFrom('p', '', '# A', '# B');
const WRITE = fc.record({
	runs: fc.array(
		fc.record({ gap: fc.nat(2), removed: fc.nat(2), inserted: fc.array(TEXT, { maxLength: 2 }) }),
		{ minLength: 1, maxLength: 3 }
	),
	named: fc.integer({ min: 0, max: 9 }).map((n) => n > 0)
});
const STEP = fc.record({
	// 65 writes that change no answer come first, so the watch has let go by the step's own.
	unread: fc.integer({ min: 0, max: 9 }).map((n) => n === 0),
	writes: fc.array(WRITE, { minLength: 1, maxLength: 3 }),
	reader: fc.nat(1)
});

/** The drawn runs as they fit a document of `n` blocks, none touching the next. */
function fitted(drawn: { gap: number; removed: number; inserted: string[] }[], n: number): Run[] {
	const runs: Run[] = [];
	let at = 0;
	for (const { gap, removed, inserted } of drawn) {
		at += gap;
		if (at > n) break;
		const taken = Math.min(removed, n - at);
		if (taken || inserted.length) runs.push({ at, removed: taken, inserted });
		at += taken + 1;
	}
	return runs;
}

/** Answers up to the last that says something, each at its index: a slot past it is none. */
const said = (answers: readonly string[]) => answers.slice(0, answers.findLastIndex(Boolean) + 1);

describe('after any writes', () => {
	it('a reader told of no change holds answers that index the blocks, and one reader alone is told only of a change', () => {
		fc.assert(
			fc.property(
				fc.array(TEXT, { minLength: 1, maxLength: 5 }),
				fc.array(STEP, { minLength: 1, maxLength: 8 }),
				fc.boolean(),
				(texts, steps, alone) => {
					const { doc, watch } = watched(texts);
					const readers = [0, 1].map(() => ({ seen: watch.version(), held: watch.keys() }));
					let letGo = false;
					for (const step of steps) {
						if (step.unread) for (let i = 0; i < 65; i++) doc.write(doc.count(), 0, ['p']);
						letGo ||= step.unread;
						for (const write of step.writes) {
							const runs = fitted(write.runs, doc.count());
							if (runs.length) doc.writeRuns(runs, write.named);
						}
						const reader = readers[alone ? 0 : step.reader];
						const fresh = doc.blocks().map(headings);
						const told = watch.version() !== reader.seen;
						const differs = said(reader.held).join('\n') !== said(fresh).join('\n');
						if (differs) expect(told, 'a change went untold').toBe(true);
						// A watch that let go tells its next reader a change whatever it finds.
						if (alone && !letGo) expect(told, 'a change was told with none').toBe(differs);
						expect(watch.keys()).toEqual(fresh);
						reader.seen = watch.version();
						reader.held = watch.keys();
					}
				}
			),
			{ numRuns: 1500, seed: freshOrFixedSeed(2125) }
		);
	});
});

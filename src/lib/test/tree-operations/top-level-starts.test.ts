// Where a document's top-level blocks start, and G1.209: the editor's kept record of them answers
// as a fresh measure does after any run of announced writes, reads only the blocks a write named,
// and a write that names the wrong blocks, or a read made before a write announced, is caught.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import type { DocumentView } from '#lib/core/node-views.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	changedRun,
	measured,
	type TopLevelChange
} from '#lib/tree-operations/top-level-starts.js';
import { takeDevWarns } from '../support/warn-gate';

afterEach(disablePerfInstruments);

const paragraphs = (n: number, word = 'line') =>
	Array.from({ length: n }, (_, i) => `${word} ${i}\n`).join('\n');
const blocks = (n: number, word: string) => parse(paragraphs(n, word)).children;

/** Every answer the starts give about `doc`. */
function answers(doc: DocumentView, starts = measured(doc).starts) {
	return {
		length: starts.length,
		ends: doc.children.map((_, i) => [starts.start(i), starts.end(i)])
	};
}

/** `doc` with a record a question has measured, and a write made the way every announcer makes one. */
function kept(doc: Document) {
	let announced = 0;
	const record = createKeptStarts(
		() => doc,
		() => announced++
	);
	void record.read().starts.length;
	return {
		record,
		announced: () => announced,
		write(mutate: () => void, changes: readonly TopLevelChange[] | null) {
			record.duringWrite(() => {
				mutate();
				return { touched: changes && (() => changes) };
			});
		}
	};
}

const SOURCES = [
	'a\n\nb\n\n\nc\n',
	'\n\nlead\n\n- one\n- two\n',
	'open',
	'> q\n\n```\ncode\n```\n'
];

describe('the starts of a measured document', () => {
	it.each(SOURCES)('each block sits where its bytes do, in %j', (source) => {
		const doc = parse(source);
		const { starts } = measured(doc);
		doc.children.forEach((block, i) => {
			expect(source.slice(starts.start(i), starts.end(i))).toBe(block.leadingTrivia + block.raw);
		});
		expect(starts.length).toBe(source.length);
	});

	it.each(SOURCES)(
		'a byte is held by the first block ending past it, or the last, in %j',
		(source) => {
			const doc = parse(source);
			const { starts } = measured(doc);
			for (let byte = 0; byte <= source.length + 1; byte++) {
				const first = doc.children.findIndex((_, i) => byte < starts.end(i));
				expect(starts.holding(byte)).toBe(first < 0 ? doc.children.length - 1 : first);
			}
		}
	);

	it('a document with no block holds no byte, and is as long as its prefix and suffix', () => {
		const { starts } = measured({ kind: 'document', prefix: '\n', children: [], suffix: '\n' });
		expect([starts.length, starts.holding(0)]).toEqual([2, -1]);
	});
});

describe('G1.209 the kept record answers as a fresh measure does', () => {
	it('after any run of writes that name their blocks, or name none', () => {
		const write = fc.record({
			at: fc.nat(40),
			removed: fc.nat(3),
			inserted: fc.nat(3),
			named: fc.boolean()
		});
		fc.assert(
			fc.property(fc.array(write, { maxLength: 12 }), fc.nat(40), (writes, asked) => {
				const doc = parse(paragraphs(8));
				const k = kept(doc);
				writes.forEach(({ at, removed, inserted, named }, round) => {
					const from = Math.min(at, doc.children.length);
					const taken = Math.min(removed, doc.children.length - from);
					const change = { at: from, removed: taken, inserted };
					k.write(
						() => doc.children.splice(from, taken, ...blocks(inserted, `w${round}`)),
						named ? [change] : null
					);
					// Read part of the way down, so the next write lands on a half-summed record.
					if (doc.children.length > 0) k.record.read().starts.end(asked % doc.children.length);
				});
				expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
				expect(serialize(doc).length).toBe(k.record.read().starts.length);
			})
		);
		expect(takeDevWarns()).toEqual([]);
	});

	// The byte splice takes its view before it writes and checks what it wrote against that view.
	it('a view read before a write that puts in a new list answers for the list it read', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		const view = k.record.read();
		const was = answers(view.doc);
		k.record.duringWrite(() => {
			doc.children = [...doc.children.slice(0, 2), ...blocks(3, 'new'), ...doc.children.slice(3)];
			doc.suffix = '\n';
			expect(answers(view.doc, view.starts)).toEqual(was);
			return { touched: () => [{ at: 2, removed: 1, inserted: 3 }] };
		});
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		// Kept past the announcement, it still answers for its own document, and leaves the record be.
		expect(answers(view.doc, view.starts)).toEqual(was);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(takeDevWarns()).toEqual([]);
	});

	it('after two runs named in one write, each counted before either was made', () => {
		const doc = parse(paragraphs(10));
		const k = kept(doc);
		k.write(() => {
			doc.children.splice(7, 2, ...blocks(1, 'low'));
			doc.children.splice(2, 1, ...blocks(3, 'high'));
		}, [
			{ at: 2, removed: 1, inserted: 3 },
			{ at: 7, removed: 2, inserted: 1 }
		]);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(takeDevWarns()).toEqual([]);
	});

	it.each([50, 200])('reads the block a write named and the last, in a document of %i', (n) => {
		const doc = parse(paragraphs(n));
		const k = kept(doc);
		resetPerfInstruments();
		enablePerfInstruments();
		k.write(() => (doc.children[3].raw = 'longer line\n'), [{ at: 3, removed: 1, inserted: 1 }]);
		expect(k.record.read().starts.end(n - 1)).toBe(serialize(doc).length);
		expect(perfSnapshot().topBlocksMeasured).toBe(2);
	});

	it('follows the last block, which a write leaving the last line open rewrites unnamed', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(() => {
			doc.children.splice(2, 1);
			doc.children[4].raw = 'line 5';
		}, [{ at: 2, removed: 1, inserted: 0 }]);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(takeDevWarns()).toEqual([]);
	});

	it('forgets on a write that names nothing, and measures again only when read', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(() => (doc.children[1].raw = 'x\n'), null);
		expect(k.record.isMeasured()).toBe(false);
		k.write(() => (doc.children[2].raw = 'y\n'), [{ at: 2, removed: 1, inserted: 1 }]);
		expect(k.record.isMeasured()).toBe(false);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(k.record.isMeasured()).toBe(true);
	});

	it('measures nothing until a position is asked for, and asks no write for its runs till then', () => {
		const doc = parse(paragraphs(6));
		const record = createKeptStarts(
			() => doc,
			() => {}
		);
		resetPerfInstruments();
		enablePerfInstruments();
		void record.read();
		record.duringWrite(() => {
			doc.children[1].raw = 'x\n';
			return {
				touched: () => expect.unreachable('a record nobody asked has no use for the runs')
			};
		});
		expect([record.isMeasured(), perfSnapshot().topBlocksMeasured]).toEqual([false, 0]);
		expect(record.read().starts.end(1)).toBe(serialize(doc).indexOf('x\n') + 2);
		expect([record.isMeasured(), perfSnapshot().topBlocksMeasured]).toEqual([true, 6]);
	});

	it('follows a document whose prefix a write changed', () => {
		const doc = parse(paragraphs(4));
		const k = kept(doc);
		k.write(() => (doc.prefix = '\n\n'), []);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
	});

	it('forgets on a run wider than it would measure', () => {
		const doc = parse(paragraphs(4));
		const k = kept(doc);
		k.write(
			() => doc.children.splice(1, 0, ...blocks(600, 'wide')),
			[{ at: 1, removed: 0, inserted: 600 }]
		);
		expect(k.record.isMeasured()).toBe(false);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
	});

	it('forgets when one write runs inside another', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.duringWrite(() => {
			doc.children[1].raw = 'outer\n';
			k.write(() => (doc.children[4].raw = 'inner\n'), [{ at: 4, removed: 1, inserted: 1 }]);
			return { touched: () => [{ at: 1, removed: 1, inserted: 1 }] };
		});
		expect(k.record.isMeasured()).toBe(false);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(takeDevWarns()).toEqual([]);
	});
});

describe('G1.209 a record told wrong, or read too early, is caught', () => {
	const tags = () => takeDevWarns().map((w) => w.tag);

	it('a write that names a block it did not change', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(() => (doc.children[3].raw = 'changed\n'), [{ at: 5, removed: 1, inserted: 1 }]);
		expect(tags()).toEqual(['invariant:kept-starts-current']);
	});

	it('a write that names one block of the two it changed', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(() => {
			doc.children[3].raw = 'changed\n';
			doc.children[4].raw = 'and its neighbour\n';
		}, [{ at: 3, removed: 1, inserted: 1 }]);
		expect(tags()).toEqual(['invariant:kept-starts-current']);
	});

	it('a write that miscounts the blocks it put in', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(
			() => doc.children.splice(2, 1, ...blocks(2, 'two')),
			[{ at: 2, removed: 1, inserted: 1 }]
		);
		expect(tags()).toEqual(['invariant:kept-starts-current']);
	});

	it.each([
		['fewer blocks than it took out', 2, { at: 2, removed: 1, inserted: 0 }],
		['more blocks than it put in', 0, { at: 5, removed: 1, inserted: 4 }]
	])('a write that names %s, which is measured again', (_name, taken, run) => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.write(() => doc.children.splice(2, taken), [run]);
		expect(tags()).toEqual(['invariant:kept-starts-current']);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		tags();
	});

	it('a read between a write and its announcement, which is answered from the tree', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.duringWrite(() => {
			doc.children[0].raw = 'a longer first line\n';
			expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
			expect(tags()).toEqual(['invariant:kept-starts-current']);
			return { touched: () => [{ at: 0, removed: 1, inserted: 1 }] };
		});
		expect(tags()).toEqual([]);
	});

	it('a write put back as it stood reads again without complaint', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.duringWrite(() => ({ touched: 'unchanged' }));
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect([k.record.isMeasured(), k.announced()]).toEqual([true, 0]);
		expect(tags()).toEqual([]);
	});

	it('a write that threw leaves nothing kept until the next write announces', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		const thrown = () =>
			k.record.duringWrite(() => {
				doc.children[1].raw = 'left behind by the rollback\n';
				throw new Error('part way');
			});
		expect(thrown).toThrow('part way');
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect([k.record.isMeasured(), k.record.unannounced(), k.announced()]).toEqual([
			false,
			true,
			0
		]);
		k.write(() => (doc.children[2].raw = 'the next write\n'), [{ at: 2, removed: 1, inserted: 1 }]);
		expect([k.record.unannounced(), k.announced()]).toEqual([false, 1]);
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(k.record.isMeasured()).toBe(true);
		expect(tags()).toEqual([]);
	});

	it('a view asked its first question between a write and its announcement', () => {
		const doc = parse(paragraphs(6));
		const record = createKeptStarts(
			() => doc,
			() => {}
		);
		const { starts } = record.read();
		record.duringWrite(() => {
			doc.children[0].raw = 'a longer first line\n';
			expect(starts.end(0)).toBe(doc.children[0].raw.length);
			expect(tags()).toEqual(['invariant:kept-starts-current']);
			return { touched: () => [{ at: 0, removed: 1, inserted: 1 }] };
		});
		expect(answers(doc, record.read().starts)).toEqual(answers(doc));
		expect(tags()).toEqual([]);
	});

	it('a block put in with no write announced, which is measured again', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		doc.children.splice(2, 0, ...blocks(1, 'unannounced'));
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(tags()).toEqual(['invariant:kept-starts-current']);
	});
});

describe('the run a write changed, found by which blocks are the same objects', () => {
	const [A, B, C, X] = ['A', 'B', 'C', 'X'].map((name) => ({ name }));

	it.each([
		['a block put in and taken out again', [A, X, C], [A, C], [A, C], [1, 1, 0]],
		['one of two blocks that are one object', [A, A], [A], [A], [1, 1, 0]],
		['a block replaced', [A, B, C], [A, X, C], [A, B, C], [1, 1, 1]],
		[
			'a block the snapshot does not hold, written in place',
			[A, B, C],
			[A, B, C],
			[A, X, C],
			[1, 1, 1]
		],
		['blocks put in at the end', [A, B], [A, B, X, C], [A, B], [2, 0, 2]],
		['nothing', [A, B], [A, B], [A, B], [2, 0, 0]],
		[
			'a snapshot of another length, matched from either end',
			[A, B, C],
			[A, B, C],
			[A, C],
			[1, 1, 1]
		]
	])('%s', (_name, before, after, shared, [at, removed, inserted]) => {
		expect(changedRun(before, after, shared)).toEqual({ at, removed, inserted });
	});
});

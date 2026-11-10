// Where a document's top-level blocks start, and G1.209: the editor's kept record of them answers
// as a fresh measure does after any run of announced writes, reads only the blocks a write named,
// and a write that names the wrong blocks, or a read made before a write announced, is caught.
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import type { Document } from '#lib/core/nodes.js';
import { createKeptStarts } from '#lib/editor-actions/commit/kept-starts.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { measured, type TopLevelChange } from '#lib/tree-operations/top-level-starts.js';
import { takeDevWarns } from '../support/warn-gate';

afterEach(disablePerfInstruments);

const paragraphs = (n: number, word = 'line') =>
	Array.from({ length: n }, (_, i) => `${word} ${i}\n`).join('\n');
const blocks = (n: number, word: string) => parse(paragraphs(n, word)).children;

/** Every answer the starts give about `doc`. */
function answers(doc: Document, starts = measured(doc).starts) {
	return {
		count: starts.count,
		length: starts.length,
		ends: doc.children.map((_, i) => [starts.start(i), starts.end(i)])
	};
}

/** `doc` with a record that has measured it, and a write made the way every announcer makes one. */
function kept(doc: Document) {
	const record = createKeptStarts(() => doc);
	record.read();
	return {
		record,
		write(mutate: () => void, changes: readonly TopLevelChange[] | null) {
			record.opened();
			mutate();
			record.changed(changes);
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
		expect([starts.count, starts.length, starts.holding(0)]).toEqual([0, 2, -1]);
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

	it.each([50, 200])('reads only the block a write named, in a document of %i', (n) => {
		const doc = parse(paragraphs(n));
		const k = kept(doc);
		resetPerfInstruments();
		enablePerfInstruments();
		k.write(() => (doc.children[3].raw = 'longer line\n'), [{ at: 3, removed: 1, inserted: 1 }]);
		expect(k.record.read().starts.end(n - 1)).toBe(serialize(doc).length);
		expect(perfSnapshot().topBlocksMeasured).toBe(1);
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
		k.record.opened();
		doc.children[1].raw = 'outer\n';
		k.write(() => (doc.children[4].raw = 'inner\n'), [{ at: 4, removed: 1, inserted: 1 }]);
		k.record.changed([{ at: 1, removed: 1, inserted: 1 }]);
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

	it('a read between a write and its announcement, which is answered from the tree', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.opened();
		doc.children[0].raw = 'a longer first line\n';
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(tags()).toEqual(['invariant:kept-starts-current']);
		k.record.changed([{ at: 0, removed: 1, inserted: 1 }]);
		expect(tags()).toEqual([]);
	});

	it('a write put back as it stood reads again without complaint', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.opened();
		k.record.abandoned();
		expect(answers(doc, k.record.read().starts)).toEqual(answers(doc));
		expect(tags()).toEqual([]);
	});

	it('an announcement no write opened', () => {
		const doc = parse(paragraphs(6));
		const k = kept(doc);
		k.record.changed(null);
		expect(tags()).toEqual(['invariant:kept-starts-current']);
	});
});

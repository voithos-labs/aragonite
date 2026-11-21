// @vitest-environment jsdom
// One range edit's work doesn't grow with the document (G4.312): a copy reads no document but the
// editor's own tree, every gesture parses and lays out only the blocks near its range, and the
// host's in-block writes are handed only those blocks. Inside a container it lays out and pairs
// only the lines near its range (G4.349), a lazy line and a table's delimiter included.
// Miss-analysis, the lines: the rows counted blocks laid out, never a container's lines, so a
// gesture in a giant quote laid out every line of it to read the one it wrote on.

import { describe, expect, it } from 'vitest';
import type { DocumentView } from '#lib/core/node-views.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { editRange, type Gesture, type Range } from '#lib/range-edit/edit-range.js';
import { rangeHost, type RangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import { changesBetween } from '#lib/tree-operations/byte-changes.js';
import { closedSplice } from '#lib/tree-operations/spliced-openers.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { noTransforms, testReading } from './test-host';

const SHAPES: Record<string, (n: number) => string> = {
	paragraphs: (n) =>
		Array.from({ length: n }, (_, i) => `paragraph ${i} with some words\n`).join('\n'),
	list: (n) => Array.from({ length: n }, (_, i) => `- item ${i} with words\n`).join(''),
	quote: (n) => Array.from({ length: n }, (_, i) => `> line ${i} with words\n>\n`).join(''),
	'nested list': (n) =>
		Array.from({ length: n }, (_, i) => `- item ${i}\n  - inner ${i} with words\n`).join(''),
	'three quotes deep': (n) =>
		Array.from({ length: n }, (_, i) => `> > > line ${i} with words\n> > >\n`).join(''),
	'quote with lazy lines': (n) =>
		Array.from({ length: n }, (_, i) => `> line ${i}\nlazy with words ${i}\n>\n`).join(''),
	table: (n) =>
		'| a | b |\n| --- | --- |\n' +
		Array.from({ length: n }, (_, i) => `| cell ${i} with | words |\n`).join('')
};

const GESTURES: (Gesture | 'caret paste' | 'ended paste' | 'moving drop')[] = [
	'copy',
	'cut',
	'backspace',
	'delete',
	{ paste: 'one\n\ntwo', plain: false, holds: 'text' },
	'caret paste',
	'ended paste',
	'moving drop'
];

/** The host, counting the documents read beside the editor's own, the blocks laid out and the
 *  block bytes its in-block writes are handed. */
function counted(host: RangeHost, current: DocumentView) {
	const work = { reads: 0, laid: 0, bytes: 0 };
	// The host reads a document once per gesture, however often the gesture asks for its bytes.
	const sources = new Set<string>();
	const handed = (doc: DocumentView, path: readonly number[]) =>
		(work.bytes += blockNodeAt(doc, path)!.raw.length);
	const { leaf } = host;
	const counting: RangeHost = {
		...host,
		read: (source) => {
			const tree = host.read(source);
			if (tree !== current && !sources.has(source)) work.reads++;
			sources.add(source);
			return tree;
		},
		layout: (doc) => {
			const layout = host.layout(doc);
			function* within(from: number, to: number) {
				for (const block of layout.within(from, to)) yield (work.laid++, block);
			}
			return { ...layout, within, block: (path) => (work.laid++, layout.block(path)) };
		},
		leaf: {
			replace: (doc, path, ...rest) => (handed(doc, path), leaf.replace(doc, path, ...rest)),
			insert: (doc, path, ...rest) => (handed(doc, path), leaf.insert(doc, path, ...rest)),
			join: (doc, head, tail, mode) => (
				handed(doc, head.path),
				handed(doc, tail.path),
				leaf.join(doc, head, tail, mode)
			),
			cut: (doc, path, ...rest) => (handed(doc, path), leaf.cut(doc, path, ...rest)),
			broken: (doc, path, ...rest) => (handed(doc, path), leaf.broken(doc, path, ...rest)),
			typed: (doc, path, ...rest) => (handed(doc, path), leaf.typed(doc, path, ...rest)),
			carried: (doc, path, ...rest) => (handed(doc, path), leaf.carried(doc, path, ...rest))
		}
	};
	return { work, host: counting };
}

/** What one gesture over a range across two blocks in the middle of `source` costs; a caret
 *  paste writes two lines at the range's start, a moving drop takes the range to the line above. */
function cost(source: string, named: (typeof GESTURES)[number], atLineEnd = false, over?: Range) {
	const start = source.indexOf('with', Math.floor(source.length / 2));
	const from = over?.from ?? (atLineEnd ? source.indexOf('\n', start) : start);
	const caretOnly = named === 'caret paste' || named === 'ended paste';
	const to = over?.to ?? (caretOnly ? from : source.indexOf('with', from + 10) + 2);
	const gesture: Gesture =
		named === 'caret paste'
			? { paste: 'one\ntwo', plain: false, holds: 'text' }
			: named === 'ended paste'
				? { paste: 'one\n\n', plain: false, holds: 'text' }
				: named === 'moving drop'
					? { drop: source.lastIndexOf('with', from - 1), copy: false }
					: named;
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const { work, host } = counted(rangeHost(reading, { source, measured: measured(tree) }), tree);
	enablePerfInstruments();
	resetPerfInstruments();
	editRange(source, { from, to }, gesture, 'source', noTransforms(host));
	const { parseBytes: parsed, linesPaired: paired, linesLaid: lines } = perfSnapshot();
	disablePerfInstruments();
	return { ...work, parsed, paired, lines };
}

/** What a shape is known to read in proportion to it, and why; the row holds that it still does,
 *  so a fix that ends it reds here and the declaration goes. */
const DECLARED: Record<string, { parsed?: string; paired?: string }> = {
	'three quotes deep': {
		parsed:
			'the splice reads inside the top-level container only, so it parses the inner quotes whole',
		paired:
			'each outer quote pairs its one child, the inner quote, line by line, as a held range does'
	}
};

/** `large` within `small` × 1.5 plus `slack`, or, where `why` declares it, past that. */
function holds(what: string, small: number, large: number, slack: number, why?: string) {
	const flat = large <= small * 1.5 + slack;
	expect(
		flat,
		`${what}: ${small} at 500, ${large} at 2,000${why ? `, declared: ${why}` : ''}`
	).toBe(!why);
}

describe('work per gesture', () => {
	for (const [shape, make] of Object.entries(SHAPES)) {
		for (const gesture of GESTURES) {
			it(`${shape}, ${JSON.stringify(gesture)}`, () => {
				const small = cost(make(500), gesture);
				const large = cost(make(2000), gesture);
				// An ended paste reads its clipboard with and without the ending, and what each Enter left.
				const reads = gesture === 'copy' ? 0 : gesture === 'ended paste' ? 5 : 3;
				expect(large.reads, 'documents read beside the editor’s own').toBeLessThanOrEqual(reads);
				const declared = DECLARED[shape] ?? {};
				// A copy reads no answer, so it parses nothing whatever the shape.
				const parses = gesture === 'copy' ? undefined : declared.parsed;
				holds('bytes parsed', small.parsed, large.parsed, 64, parses);
				expect(
					large.laid,
					`blocks laid out: ${small.laid} at 500 blocks, ${large.laid} at 2,000`
				).toBeLessThanOrEqual(small.laid * 1.5 + 64);
				expect(
					large.bytes,
					`bytes handed the host: ${small.bytes} at 500 blocks, ${large.bytes} at 2,000`
				).toBeLessThanOrEqual(small.bytes * 1.5 + 4096);
				holds('container lines laid out', small.lines, large.lines, 64);
				holds('container lines paired', small.paired, large.paired, 64, declared.paired);
			});
		}
	}

	// Miss-analysis: the ended paste stood mid-text, where no ending is Enter's exit from a list, so
	// no row saw the answer of that exit read again from its bytes.
	it('two endings at an item’s end read the list Enter’s exit split no more than the exit does', () => {
		const source = SHAPES.list(2000);
		// The exit's own rebuild parses the list about twice; each read of its answer is a parse more.
		expect(cost(source, 'ended paste', true).parsed).toBeLessThanOrEqual(source.length * 2.5);
	});

	// Miss-analysis, the commit: the rows counted the core alone, and the commit reads the exit's
	// bytes again, where the splice grew its window over the broken list to its end.
	it('two endings at an item’s end: the commit reads the list the exit split once', () => {
		const source = SHAPES.list(2000);
		const from = source.indexOf('\n', source.indexOf('item 6 '));
		const gesture: Gesture = { paste: 'x\n\n', plain: false, holds: 'text' };
		// The top-level read of the two lists and the line between parses the list's bytes once.
		expect(committedCost(source, from, gesture).commit).toBeLessThanOrEqual(source.length * 1.5);
	});
});

// Miss-analysis: every costed range crossed two paragraphs, so the read-back that decides whether a
// paragraph a range empties keeps its line, asked of a range from a block taken whole, went uncounted.
describe('a range from a block taken whole to the end of a paragraph it empties', () => {
	const make = (n: number) =>
		SHAPES.paragraphs(n / 2) + '\n***\n\nemptied\n\n' + SHAPES.paragraphs(n / 2);
	const over = (source: string): Range => {
		const from = source.indexOf('***');
		return { from, to: source.indexOf('emptied') + 'emptied'.length };
	};
	for (const gesture of ['backspace', 'delete', 'cut'] as const) {
		it(`${gesture} reads back only the blocks near it`, () => {
			const [small, large] = [500, 2000].map((n) => cost(make(n), gesture, false, over(make(n))));
			expect(large.reads, 'documents read beside the editor’s own').toBeLessThanOrEqual(3);
			holds('bytes parsed', small.parsed, large.parsed, 64);
			expect(large.laid, `blocks laid out: ${small.laid}, ${large.laid}`).toBeLessThanOrEqual(
				small.laid * 1.5 + 64
			);
		});
	}
});

/** The bytes parsed by `gesture` at a caret at `at`, and then by the commit landing its answer,
 *  which takes the core's reading of those bytes where it made one and reads them where it didn't. */
function committedCost(source: string, at: number, gesture: Gesture) {
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const current = { source, measured: measured(tree) };
	enablePerfInstruments();
	resetPerfInstruments();
	const host = noTransforms(rangeHost(reading, current));
	const answer = editRange(source, { from: at, to: at }, gesture, 'source', host).source;
	const core = perfSnapshot().parseBytes;
	closedSplice(current.measured, source, changesBetween(source, answer), reading.grammar);
	const commit = perfSnapshot().parseBytes - core;
	disablePerfInstruments();
	return { core, commit };
}

// Miss-analysis: the rows costed the gestures a key, a cut or a paste makes, never the place a line
// break over a range takes, whose empty paragraph is spelled off a copy of the whole document.
describe('the place a line break over whole blocks takes', () => {
	/** The bytes `openedAt` serializes for the place over a rule and a heading amid `n` paragraphs. */
	function spelled(n: number): number {
		const source = SHAPES.paragraphs(n / 2) + '\n***\n\n# head\n\n' + SHAPES.paragraphs(n / 2);
		const range = { from: source.indexOf('***'), to: source.indexOf('# head') + '# head'.length };
		const reading = testReading();
		const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
		const host = rangeHost(reading, { source, measured: measured(tree) });
		let bytes = 0;
		const counting: RangeHost = {
			...host,
			openedAt: (doc, parent, index) => {
				const out = host.openedAt(doc, parent, index);
				bytes += out?.source.length ?? 0;
				return out;
			}
		};
		const answer = editRange(source, range, 'place', 'source', noTransforms(counting));
		expect(answer.opened, 'the place is an empty paragraph opened where the range was').toBe(true);
		return bytes;
	}

	// Declared: the empty paragraph's one writer serializes the copied document to spell it
	// (`tree-operations/opened-paragraph.ts`), so a fix that ends that reds this row.
	it('spells its empty paragraph off the whole document', () => {
		expect(spelled(2000)).toBeGreaterThan(spelled(500) * 3);
	});
});

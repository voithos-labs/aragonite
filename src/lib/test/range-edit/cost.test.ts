// @vitest-environment jsdom
// One range edit's work doesn't grow with the document (G4.312): a copy reads no document but the
// editor's own tree, every gesture parses and lays out only the blocks near its range, and the
// host's in-block writes are handed only those blocks.

import { describe, expect, it } from 'vitest';
import type { DocumentView } from '#lib/core/node-views.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { editRange, type Gesture } from '#lib/range-edit/edit-range.js';
import { rangeHost, type RangeHost } from '#lib/range-edit/host.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
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
		Array.from({ length: n }, (_, i) => `- item ${i}\n  - inner ${i} with words\n`).join('')
};

const GESTURES: Gesture[] = [
	'copy',
	'cut',
	'backspace',
	{ paste: 'one\n\ntwo', plain: false, holds: 'text' }
];

/** The host, counting the documents read beside the editor's own, the blocks laid out and the
 *  block bytes its in-block writes are handed. */
function counted(host: RangeHost, current: DocumentView) {
	const work = { reads: 0, laid: 0, bytes: 0 };
	const handed = (doc: DocumentView, path: readonly number[]) =>
		(work.bytes += blockNodeAt(doc, path)!.raw.length);
	const { leaf } = host;
	const counting: RangeHost = {
		...host,
		read: (source) => {
			const tree = host.read(source);
			if (tree !== current) work.reads++;
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
			carried: (doc, path, ...rest) => (handed(doc, path), leaf.carried(doc, path, ...rest))
		}
	};
	return { work, host: counting };
}

/** What one gesture over a range across two blocks in the middle of `source` costs. */
function cost(source: string, gesture: Gesture) {
	const from = source.indexOf('with', Math.floor(source.length / 2));
	const to = source.indexOf('with', from + 10) + 2;
	const reading = testReading();
	const tree = readAsOpened(source, { grammar: reading.grammar, scope: 'document' });
	const { work, host } = counted(rangeHost(reading, { source, measured: measured(tree) }), tree);
	enablePerfInstruments();
	resetPerfInstruments();
	editRange(source, { from, to }, gesture, 'source', noTransforms(host));
	const parsed = perfSnapshot().parseBytes;
	disablePerfInstruments();
	return { ...work, parsed };
}

describe('work per gesture', () => {
	for (const [shape, make] of Object.entries(SHAPES)) {
		for (const gesture of GESTURES) {
			it(`${shape}, ${JSON.stringify(gesture)}`, () => {
				const small = cost(make(500), gesture);
				const large = cost(make(2000), gesture);
				expect(large.reads, 'documents read beside the editor’s own').toBeLessThanOrEqual(
					gesture === 'copy' ? 0 : 3
				);
				expect(
					large.parsed,
					`bytes parsed: ${small.parsed} at 500 blocks, ${large.parsed} at 2,000`
				).toBeLessThanOrEqual(small.parsed * 1.5 + 64);
				expect(
					large.laid,
					`blocks laid out: ${small.laid} at 500 blocks, ${large.laid} at 2,000`
				).toBeLessThanOrEqual(small.laid * 1.5 + 64);
				expect(
					large.bytes,
					`bytes handed the host: ${small.bytes} at 500 blocks, ${large.bytes} at 2,000`
				).toBeLessThanOrEqual(small.bytes * 1.5 + 4096);
			});
		}
	}
});

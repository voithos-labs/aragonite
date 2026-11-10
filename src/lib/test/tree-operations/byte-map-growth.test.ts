// A container's byte map (where a caret lands after a splice, where a copy's ends sit): a question
// about one child pairs that child's lines alone, the same count at N and 4N children, and the whole
// map a container without spans takes costs in proportion to the container, timed at N and 4N bytes.
// Miss-analysis: the byte map's cost rows priced a list, which it reads through its child spans and
// never pairs line by line, so no row counted or timed the line pairing a quote or a table takes.
import { afterEach, describe, expect, it } from 'vitest';
import type { Document } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import {
	byteOfLeaf,
	documentByteMap,
	leafAtByte,
	leafAtRawOffset,
	rawOffsetOfLeaf
} from '#lib/tree-operations/container-offsets.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { gapAtByte } from '#lib/selection/range-bytes.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { expectBoundedGrowth, measureScanGrowth, type ScanSource } from '../harness/scan-growth';
import { measured } from '#lib/tree-operations/top-level-starts.js';

/** Each run builds the map afresh twice, so its pairing outweighs the parse in the timing. */
function mapTwice(source: string): void {
	const doc = parse(source);
	const container = doc.children[0];
	// Without its spans, as a stale span leaves it, the map pairs every line of the container.
	container.childSpans = undefined;
	const middle = Math.floor(source.length / 2);
	documentByteMap(measured(doc)).leafAt(middle);
	const child = Math.floor(container.children!.length / 2);
	documentByteMap(measured(doc)).byteOf(container.kind === 'table' ? [0, child, 0] : [0, child], 0);
}

const SHAPES: [string, ScanSource][] = [
	['a quote', '> one two three four\n>\n'],
	[
		'a table',
		(bytes, salt) =>
			'| a | b |\n| --- | --- |\n' +
			'| one | two |\n'.repeat(Math.ceil(bytes / 14)) +
			`| ${salt}x | y |\n`
	]
];

describe("a container's byte map grows with the container", () => {
	it.each(SHAPES)(
		'in %s',
		(_, source) => {
			expectBoundedGrowth(measureScanGrowth(mapTwice, source, [64, 256]));
		},
		300_000
	);
});

// ── One child's lines ────────────────────────────────────────────────────────

const N = 2000;

/** A container `n` children long, the path to child `c`'s text and the byte `c`'s text starts at. */
const CONTAINERS = {
	quote: {
		source: (n: number) => '> one two three\n>\n'.repeat(n),
		leaf: (c: number) => [0, c],
		start: (c: number) => c * 18 + 2
	},
	table: {
		source: (n: number) => '| a | b |\n| --- | --- |\n' + '| one | two |\n'.repeat(n),
		leaf: (c: number) => [0, c, 0],
		start: (c: number) => 24 + (c - 1) * 14 + 2
	}
};

type Container = (typeof CONTAINERS)[keyof typeof CONTAINERS];

/** Every way a question about one child reaches the container's map. */
const ROUTES: [string, (doc: Document, shape: Container, c: number) => unknown][] = [
	['leafAtByte', (doc, shape, c) => leafAtByte(measured(doc), shape.start(c) + 3)],
	['byteOfLeaf', (doc, shape, c) => byteOfLeaf(measured(doc), shape.leaf(c), 3)],
	['leafAtRawOffset', (doc, shape, c) => leafAtRawOffset(doc.children[0], shape.start(c) + 3)],
	[
		'rawOffsetOfLeaf',
		(doc, shape, c) => rawOffsetOfLeaf(doc.children[0], shape.leaf(c).slice(1), 3)
	],
	['a layout block', (doc, _shape, c) => documentLayout(measured(doc)).block([0, c])],
	['gapAtByte', (doc, shape, c) => gapAtByte(measured(doc), shape.start(c))]
];

/** Lines the route pairs to answer for the middle child of a container `n` children long. */
function linesPaired(shape: Container, n: number, ask: (typeof ROUTES)[number][1]): number {
	const doc = parse(shape.source(n));
	enablePerfInstruments();
	resetPerfInstruments();
	ask(doc, shape, n >> 1);
	return perfSnapshot().linesPaired;
}

/** The two routes that read a line-prefixed container only, and refuse a table. */
const STRIP_ONLY = ['leafAtRawOffset', 'rawOffsetOfLeaf'];

afterEach(() => disablePerfInstruments());

describe('a question about one child pairs only its lines', () => {
	for (const [name, shape] of Object.entries(CONTAINERS)) {
		const routes = ROUTES.filter(([route]) => name === 'quote' || !STRIP_ONLY.includes(route));
		it.each(routes)(`in a ${name}: %s`, (_, ask) => {
			const small = linesPaired(shape, N, ask);
			expect(small).toBeGreaterThan(0);
			expect(linesPaired(shape, 4 * N, ask)).toBe(small);
		});
	}
});

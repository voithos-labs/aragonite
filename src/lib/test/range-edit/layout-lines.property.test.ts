// @vitest-environment jsdom
// G4.349: the range-edit layout lays out a container's lines one at a time, from the child region
// holding the byte, and each line it lays out is the line the container's whole pairing gives, at
// every byte of the document: through its own spans, a document the splice just wrote into, and a
// container whose spans a write dropped. Lines between two bytes are the whole pairing's run.
// Miss-analysis: new surface; the layout laid out every line of a container to answer one.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout, type LaidBlock, type LaidLine } from '#lib/range-edit/layout.js';
import { documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { splitLines } from '#lib/core/lines.js';
import { blockFacts } from '#lib/schema/block-facts.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { measured, type Measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { arbLawDocument } from '../range-laws/shapes';
import { testReading } from './test-host';

const DOCUMENTS = process.env.RANGE_EDIT_FULL === '1' ? 600 : 150;
const SEED = freshOrFixedSeed(20261112);

/** The shapes a drawn document may miss: line endings, tabs in markers, lazy lines, a quote's own
 *  trailing lines, depth, a table's delimiter, and the containers that pair every line. */
const NAMED = [
	'> one\r\n>\r\n> two\r\n> three\r\n\r\nafter\r\n',
	'>\tone\n>\ttwo\n\n-\tthree\n\tfour\n',
	'> one\nlazy line\nanother\n> two\n>\n> three\n',
	'> one\n>\n> two\n>\n>\n\nafter\n',
	'> > > one\n> > >\n> > > two\n> > > three\n>\n> outer\n',
	'| a | b |\n| --- | --- |\n| c | d |\n| e | f |\n\nafter\n',
	'- one\n- two\n  more\n- three\n',
	'1. one\n2. two\n   more\n10. ten\n',
	'> [!NOTE]\n> body\n>\n> more\n',
	':::note Title\none\n\ntwo\n:::\n\nafter\n',
	'<details>\n<summary>S</summary>\n\nbody\n\n</details>\n',
	'- > quoted in a list\n  > more\n- next\n',
	'> - item\n>   cont\n> - two\n>\n> para\n',
	'> one\n> two',
	'>\n>\n> one\n> two\n',
	'>\t>\tone\r\n>\t>\ttwo\r\n>\r\n> three\r\n',
	'> > one\nlazy\n> two\n',
	' > one\n  >\n   > two\n',
	'> | a | b |\n> | - | - |\n> | c | d |\n',
	'| a |\n| - |\n',
	'> ```\n> code\n>\n> ```\n> after\n',
	'- a\n  - b\n    - c\n  - d\n- e\n',
	'- a\n\n- b\n\n  para\n- c\n',
	'-\tone\r\n\ttwo\r\n-\tthree\r\n',
	'> <details>\n> <summary>S</summary>\n>\n> body\n> </details>\n'
];

/** Where a write inside `source` lands that the splice reads into a container: a letter on the
 *  middle line of each of its first containers, a line split there, and that line joined to the next. */
function editsOf(source: string, doc: DocumentView): string[] {
	// No caret sits inside a CRLF, so a letter typed there goes past it.
	const typed = (at: number) => {
		const to = source[at - 1] === '\r' && source[at] === '\n' ? at + 1 : at;
		return source.slice(0, to) + 'x' + source.slice(to);
	};
	const edits = [typed(source.length >> 1)];
	const containers = [...documentLayout(measured(doc)).within(0, source.length)].filter(
		(b) => b.container
	);
	for (const block of containers.slice(0, 4)) {
		const line = block.lineAt!((block.from + block.to) >> 1);
		edits.push(typed(line.markerTo));
		const ending = /\r?\n$/.exec(source.slice(line.from, line.to))?.[0];
		if (!ending) continue;
		const eol = line.to - ending.length;
		edits.push(source.slice(0, eol) + ending + 'x' + source.slice(eol));
		if (line.to < block.to) edits.push(source.slice(0, eol) + source.slice(line.to));
	}
	return edits;
}

type Line = Pick<LaidLine, 'from' | 'markerTo' | 'to' | 'own'>;

/** The container at `path` with no child spans, every line paired whole, placed here rather than
 *  by `lineBytes` so a slip there shows; a list's lines carry no marker. */
function everyLine(m: Measured, path: readonly number[]): Line[] {
	const map = documentByteMap(m);
	const node = blockNodeAt(m.doc, path)!;
	const bare = { ...m.doc, children: m.doc.children.map(spansDropped) };
	const whole = documentByteMap(measured(bare)).containerMap(blockNodeAt(bare, path)!);
	if (!whole?.lineAt) return [];
	const list = blockFacts(node.kind).lines === 'items';
	return splitLines(node.raw).map(({ start }) => {
		const line = whole.lineAt!(start);
		const own = !list && line.own;
		const to = map.endOf(path, line.end)!;
		const markerTo = own ? to : map.byteOf(path, list ? line.start : line.markerEnd)!;
		return { from: map.byteOf(path, line.start)!, markerTo, to, own };
	});
}

const holding = (lines: Line[], byte: number) => {
	const at = lines.findIndex((line) => byte < line.to);
	return at < 0 ? lines.length - 1 : at;
};

const shown = ({ from, markerTo, to, own }: Line) => JSON.stringify({ from, markerTo, to, own });

/** How the layout's lines of `doc` differ from the whole pairing's. */
function differences(source: string, doc: DocumentView): string[] {
	const m = measured(doc);
	const out: string[] = [];
	for (const block of documentLayout(m).within(0, source.length)) {
		if (!block.container) continue;
		const want = everyLine(m, block.path);
		if (want.length === 0) continue;
		const where = `[${block.path}] of ${JSON.stringify(source)}`;
		for (let byte = 0; byte <= source.length; byte++) {
			const got = block.lineAt!(byte);
			if (shown(got) !== shown(want[holding(want, byte)]))
				out.push(
					`line at ${byte}: ${shown(got)}, whole ${shown(want[holding(want, byte)])} ${where}`
				);
			if (block.lineAt!(byte) !== got) out.push(`line at ${byte} laid out twice ${where}`);
		}
		for (const [i, line] of want.entries()) {
			const ends = [...want.slice(i).map((l) => l.from), line.to - 1, block.to];
			for (const to of ends) out.push(...runDiffers(block, want, line.from, to, where));
			if (line.to - line.from > 1)
				out.push(...runDiffers(block, want, line.from + 1, ends[0], where));
		}
	}
	return out;
}

function runDiffers(block: LaidBlock, want: Line[], from: number, to: number, where: string) {
	const expected: Line[] = [];
	for (let k = holding(want, from); k < want.length && want[k].from <= to; k++)
		expected.push(want[k]);
	const got = [...block.linesIn!(from, to)];
	const same =
		got.length === expected.length && got.every((line, k) => shown(line) === shown(expected[k]));
	const identity = got.every((line) => line === block.lineAt!(line.from));
	if (same && identity) return [];
	return [`lines ${from} to ${to}: ${got.map(shown)}, whole ${expected.map(shown)} ${where}`];
}

/** `node` with no child spans anywhere under it, as a write that dropped them leaves it. */
function spansDropped(node: NodeView): NodeView {
	const children = node.children?.map(spansDropped);
	return { ...node, childSpans: undefined, ...(children && { children }) } as NodeView;
}

const report = (fails: string[]) =>
	fails.length === 0 ? '' : `${fails.slice(0, 10).join('\n')}\n(${fails.length} in all)`;

describe('G4.349 a container line laid out alone is the whole pairing’s', () => {
	it(
		`over ${DOCUMENTS} drawn documents and the named shapes, seed ${SEED}`,
		{ timeout: DOCUMENTS * 200 },
		() => {
			const reading = testReading();
			// The documents the range-edit laws draw from the same seed.
			const drawn = fc.sample(arbLawDocument, { numRuns: DOCUMENTS, seed: SEED });
			const fails: string[] = [];
			let containers = 0;
			const host = rangeHost(reading);
			for (const source of [...NAMED, ...drawn]) {
				const doc = host.read(source);
				containers += [...documentLayout(measured(doc)).within(0, source.length)].filter(
					(b) => b.container
				).length;
				fails.push(...differences(source, doc));
				const dropped = { ...doc, children: doc.children.map(spansDropped) };
				fails.push(...differences(source, dropped));
				// A document the splice wrote into. An editor always holds a block, where a parse of blank
				// lines alone gives none.
				if (doc.children.length === 0) continue;
				const own = rangeHost(reading, { source, measured: measured(doc) });
				for (const edited of editsOf(source, doc)) {
					try {
						fails.push(...differences(edited, own.read(edited)));
					} catch (error) {
						fails.push(`${(error as Error).message} reading ${JSON.stringify(edited)}`);
					}
				}
			}
			expect(report(fails)).toBe('');
			expect(containers).toBeGreaterThan(DOCUMENTS / 2);
		}
	);
});

// @vitest-environment jsdom
// G4.349: the range-edit layout lays out a container's lines one at a time, from the child region
// holding the byte, and each line it lays out is the line the container's whole pairing gives, at
// every byte of the document: through its own spans, a document the splice just wrote into, and a
// container whose spans a write dropped. Lines between two bytes are the whole pairing's run.
// Miss-analysis: new surface; the layout laid out every line of a container to answer one.

import { describe, expect, it } from 'vitest';
import type { DocumentView, NodeView } from '#lib/core/node-views.js';
import { rangeHost } from '#lib/range-edit/host.js';
import { documentLayout, type LaidBlock, type LaidLine } from '#lib/range-edit/layout.js';
import { containerLines, documentByteMap } from '#lib/tree-operations/container-offsets.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { measured, type Measured } from '#lib/tree-operations/top-level-starts.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';
import { lawInputs } from './inputs';
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
	'> one\n> two'
];

type Line = Pick<LaidLine, 'from' | 'markerTo' | 'to' | 'own'>;

/** Every line of the container at `path`, paired whole and placed in the bytes: the expected
 *  result, placed here rather than by `lineBytes`, so a slip there shows. */
function everyLine(m: Measured, path: readonly number[]): Line[] {
	const map = documentByteMap(m);
	const own = map.containerMap(blockNodeAt(m.doc, path)!);
	return (own && containerLines(own) ? containerLines(own)! : []).map((line) => {
		const to = map.endOf(path, line.end)!;
		const markerTo = line.own ? to : map.byteOf(path, line.markerEnd)!;
		return { from: map.byteOf(path, line.start)!, markerTo, to, own: line.own };
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
	it(`over ${DOCUMENTS} drawn documents and the named shapes, seed ${SEED}`, () => {
		const reading = testReading();
		const drawn = lawInputs(DOCUMENTS, SEED, reading.grammar).filter((_, i) => i % 2 === 0);
		const fails: string[] = [];
		let containers = 0;
		const host = rangeHost(reading);
		for (const source of [...NAMED, ...drawn.map((input) => input.source)]) {
			const doc = host.read(source);
			containers += [...documentLayout(measured(doc)).within(0, source.length)].filter(
				(b) => b.container
			).length;
			fails.push(...differences(source, doc));
			const dropped = { ...doc, children: doc.children.map(spansDropped) };
			fails.push(...differences(source, dropped));
			// A document the splice wrote into: a letter typed in the middle of the source. An editor
			// always holds a block, where a parse of blank lines alone gives none.
			if (doc.children.length === 0) continue;
			const own = rangeHost(reading, { source, measured: measured(doc) });
			const at = source.length >> 1;
			const edited = source.slice(0, at) + 'x' + source.slice(at);
			try {
				fails.push(...differences(edited, own.read(edited)));
			} catch (error) {
				fails.push(`${(error as Error).message} reading ${JSON.stringify(edited)}`);
			}
		}
		expect(report(fails)).toBe('');
		expect(containers).toBeGreaterThan(DOCUMENTS / 2);
	});
});

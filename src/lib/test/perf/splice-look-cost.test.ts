// G4.347: what a byte splice parses and asks to find where its window starts and stops, in a run
// with no blank line. The bytes parsed are the same at N lines and 4N, what a reading is asked
// grows no faster than the run, and a run under a title that has started is read through, never
// once a block.
// Miss-analysis: the splice's cost rows counted bytes parsed, so nothing held what the look for a
// waiting definition asks, and a run of code and definitions was read whole unseen. No row drew a
// title that starts under every definition, so each was asked of the whole run below it.
import { describe, it, expect, afterEach } from 'vitest';
import { serialize } from '#lib/core/serializer.js';
import {
	defaultGrammarView,
	unfinishedReadings,
	type UnfinishedReading
} from '#lib/schema/block-openers.js';
import { initDocument } from '#lib/components/editor-root/document-swap.js';
import { assignChildIdsDeep } from '#lib/block-id.js';
import { spliceReading } from '#lib/tree-operations/byte-splice.js';
import { measured } from '#lib/tree-operations/top-level-starts.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

const N = 2000;

/** Line `i`'s text, the same length at every size. */
const word = (i: number) => `word ${String(i).padStart(6, '0')}`;
const lines = (n: number, line: (i: number) => string[]) =>
	Array.from({ length: n }, (_, i) => line(i)).flat();

/** How a shape's cost may grow with its run: not at all, by its asks alone, or with the run. */
type Growth = 'flat' | 'asks' | 'run';

const SHAPES: Record<string, { growth: Growth; run: (n: number) => string[] }> = {
	headings: { growth: 'flat', run: (n) => lines(n, (i) => [`# ${word(i)}`]) },
	'headings under a definition': {
		growth: 'flat',
		run: (n) => ['[a]: /u', ...lines(n - 1, (i) => [`# ${word(i)}`])]
	},
	'paragraphs apart under a definition': {
		growth: 'flat',
		run: (n) => ['[a]: /u', ...lines(n >> 1, (i) => ['', word(i)])]
	},
	definitions: { growth: 'asks', run: (n) => lines(n, (i) => [`[${word(i)}]: /u`]) },
	'definitions with a title on the next line': {
		growth: 'asks',
		run: (n) => lines(n >> 1, (i) => [`[${word(i)}]: /u`, `    "${word(i)}"`])
	},
	'code and definitions alternating': {
		growth: 'asks',
		run: (n) => lines(n >> 1, (i) => [`[${word(i)}]: /u`, `    ${word(i)}`])
	},
	'definitions each under a title started in code': {
		growth: 'asks',
		run: (n) => lines(n >> 1, (i) => [`[${word(i)}]: /u`, `    '${word(i)}`])
	},
	'a long code block between two definitions': {
		growth: 'asks',
		run: (n) => ['[a]: /u', ...lines(n - 2, (i) => [`    ${word(i)}`]), '[b]: /v']
	},
	'definitions under a title that has started': {
		growth: 'run',
		run: (n) => ['[a]: /u', '    "code', ...lines(n - 2, (i) => [`[${word(i)}]: /u`])]
	}
};

/** A letter typed at the end of the line `under`: by default a text line at the run's foot, with
 *  two headings below it. */
function cost(shape: keyof typeof SHAPES, n: number, quoted: boolean, under = 'tail text') {
	const text =
		[...SHAPES[shape].run(n), 'tail text', '# end', '# end']
			.map((line) => (quoted ? `> ${line}` : line))
			.join('\n') + '\n';
	const { doc } = initDocument(text, defaultGrammarView);
	for (const block of doc.children) assignChildIdsDeep(block);
	const before = serialize(doc);
	const at = before.indexOf(under) + under.length;
	const changes = [{ from: at, to: at, insert: 'x' }];
	const readings = unfinishedReadings(defaultGrammarView) as UnfinishedReading[];
	const saved = readings.map((reading) => reading.notFinal);
	let asks = 0;
	let asked = 0;
	readings.forEach((reading, k) => {
		reading.notFinal = (raw) => (asks++, (asked += raw.length), saved[k](raw));
	});
	enablePerfInstruments();
	resetPerfInstruments();
	try {
		spliceReading(measured(doc), before, changes, defaultGrammarView);
	} finally {
		readings.forEach((reading, k) => (reading.notFinal = saved[k]));
	}
	return { parsed: perfSnapshot().parseBytes, asks, asked, length: before.length };
}

afterEach(() => disablePerfInstruments());

describe('the look for a waiting definition, in a run with no blank line', () => {
	for (const shape of Object.keys(SHAPES)) {
		for (const quoted of [false, true]) {
			it(`grows no faster than its shape allows: ${shape}${quoted ? ', in a quote' : ''}`, () => {
				const small = cost(shape, N, quoted);
				const large = cost(shape, 4 * N, quoted);
				const { growth } = SHAPES[shape];
				expect(small.parsed).toBeGreaterThan(0);
				if (growth === 'run') {
					// The whole run is in the title's reach: read at most twice, asked a few times over.
					for (const [{ parsed, asks, asked, length }, n] of [
						[small, N],
						[large, 4 * N]
					] as const) {
						expect(parsed).toBeLessThan(2.5 * length);
						expect(asks).toBeLessThan(2.5 * n);
						expect(asked).toBeLessThan(6 * length);
					}
					return;
				}
				expect(small.parsed).toBeLessThan(400);
				expect(large.parsed).toBe(small.parsed);
				if (growth === 'flat') expect(large.asks).toBe(small.asks);
				// Each block is asked with the line under it, and one that line leaves waiting with a
				// few blocks more: four times the lines, four times the asks and the bytes.
				expect(large.asks).toBeLessThan(4 * small.asks + 64);
				expect(small.asks).toBeLessThan(2 * N + 64);
				expect(large.asked).toBeLessThan(4 * small.asked + 4096);
			});
		}
	}

	// Miss-analysis: every block in the rows above is a line or two long, so asking a definition with
	// the whole block under it cost what asking it with that block's first line does.
	it('asks a definition with the first line of a long block under it, not the block', () => {
		const { asked, length } = cost('a long code block between two definitions', 4 * N, false);
		expect(asked).toBeLessThan(1.5 * length);
	});

	// Miss-analysis: every row changed the run's foot, where the first read already holds the run,
	// so nothing held a read that starts at the head to reaching the foot in one more step.
	it('reads a run under a started title through from a change at its head', () => {
		for (const n of [N, 4 * N]) {
			const first = `[${word(0)}]: /u`;
			const { parsed, asks, length } = cost(
				'definitions under a title that has started',
				n,
				false,
				first
			);
			expect(parsed).toBeLessThan(2.5 * length);
			expect(asks).toBeLessThan(2.5 * n);
		}
	});
});

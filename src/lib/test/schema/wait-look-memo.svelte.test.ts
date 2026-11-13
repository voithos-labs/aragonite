// @vitest-environment jsdom
// The look for a wait keeps what each block answered with the first line of the block under it.
// After any change to a `$state` list (bytes or blank lines written in place, a block replaced or
// moved, two blocks of the same bytes, another set of readings, a paragraph interrupt registered),
// every look answers as a look that keeps nothing.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CstNode } from '#lib/core/nodes.js';
import {
	defaultGrammarView,
	unfinishedReadings,
	waitingAboveThrough,
	waitingInto,
	type UnfinishedReading
} from '#lib/schema/block-openers.js';
import { opened } from '#lib/test/exhaustive/edit-driver.js';
import { testLeaf } from '#lib/test/harness/test-kinds.js';
import { freshOrFixedSeed } from '../invariants/arbitraries/property-seed';

type Held = Pick<CstNode, 'raw' | 'leadingTrivia'>;

/** A reading no line closes, as a plugin declares one: a block opening with `mark` waits until a
 *  line ends in it. */
const waitsFor = (mark: string): UnfinishedReading => ({
	notFinal: (raw) => raw.startsWith(mark) && !raw.slice(1).trimEnd().endsWith(mark),
	closer: null,
	crosses: (line) => !line.startsWith('#')
});
/** The editor's own readings, then with one plugin's, then with another of the same count. */
const READINGS = [[], [waitsFor('%')], [waitsFor('~')]];

const LINES = [
	'[a]: /u',
	'[b]: /v',
	'[b]: /v',
	"    'code",
	'    "code',
	"'t",
	'text',
	"end'",
	'end"',
	'# h',
	'#h',
	'%',
	'% x',
	'x %',
	'~',
	'x ~',
	''
];

const arbDocument = fc
	.array(fc.constantFrom(...LINES), { minLength: 3, maxLength: 12 })
	.map((lines) => `[a]: /u\n${lines.join('\n')}\n`);

type Step =
	| { write: number; text: string }
	| { line: number; text: string }
	| { blank: number }
	| { copy: number }
	| { move: number; to: number }
	| { twin: number }
	| { readings: number };

const arbStep: fc.Arbitrary<Step> = fc.oneof(
	fc.record({ write: fc.nat(), text: fc.constantFrom("'", '"', '%', '# ', '', 'x') }),
	fc.record({ line: fc.nat(), text: fc.constantFrom(...LINES.filter(Boolean)) }),
	fc.record({ blank: fc.nat() }),
	fc.record({ copy: fc.nat() }),
	fc.record({ move: fc.nat(), to: fc.nat() }),
	fc.record({ twin: fc.nat() }),
	fc.record({ readings: fc.nat(READINGS.length - 1) })
);

/** `step` applied to `list` in place: a block's bytes, its whole line or its blank lines written
 *  on the same node, a node replaced by a copy, moved, or a node of the same bytes put beside it. */
function apply(list: Held[], step: Step): void {
	const pick = (n: number) => n % list.length;
	if ('write' in step) {
		const node = list[pick(step.write)];
		const body = node.raw.replace(/\r?\n$/, '');
		node.raw = `${step.text === '' ? body.slice(0, -1) : body + step.text}\n`;
	} else if ('line' in step) {
		list[pick(step.line)].raw = `${step.text}\n`;
	} else if ('blank' in step) {
		const node = list[pick(step.blank)];
		node.leadingTrivia = node.leadingTrivia === '' ? '\n' : '';
	} else if ('copy' in step) {
		const i = pick(step.copy);
		list[i] = { ...list[i] };
	} else if ('move' in step) {
		const [node] = list.splice(pick(step.move), 1);
		list.splice(step.to % (list.length + 1), 0, node);
	} else if ('twin' in step) {
		const i = pick(step.twin);
		list.splice(i + 1, 0, { raw: list[i].raw, leadingTrivia: '' });
	}
}

/** Every join where the kept look and a look over fresh copies differ. */
function differences(list: readonly Held[], readings: readonly UnfinishedReading[]): string[] {
	const kept = (i: number) => list[i];
	const fresh = (i: number) => ({ raw: list[i].raw, leadingTrivia: list[i].leadingTrivia });
	const out: string[] = [];
	for (let j = 1; j < list.length; j++) {
		const into = [waitingInto(kept, j, 0, readings), waitingInto(fresh, j, 0, readings)];
		const through = [
			waitingAboveThrough(kept, j, 0, readings),
			waitingAboveThrough(fresh, j, 0, readings)
		];
		if (into[0] !== into[1]) out.push(`waitingInto at ${j}: ${into}`);
		if (through[0] !== through[1]) out.push(`waitingAboveThrough at ${j}: ${through}`);
	}
	return out;
}

const SEED = freshOrFixedSeed(20261112);

describe('the look for a wait answers as a look that keeps nothing', () => {
	it(`after every step of a drawn session, seed ${SEED}`, () => {
		const base = unfinishedReadings(defaultGrammarView);
		fc.assert(
			fc.property(
				arbDocument,
				fc.array(arbStep, { minLength: 1, maxLength: 12 }),
				(source, steps) => {
					const list: Held[] = $state(opened(source).children.map((n) => ({ ...n })));
					let readings: readonly UnfinishedReading[] = base;
					expect(differences(list, readings)).toEqual([]);
					for (const step of steps) {
						if ('readings' in step) readings = [...base, ...READINGS[step.readings]];
						else apply(list, step);
						expect(differences(list, readings), JSON.stringify(step)).toEqual([]);
					}
				}
			),
			{ numRuns: 300, seed: SEED }
		);
	});

	it('after a paragraph interrupt is registered under a started title', () => {
		// The definition, the code its title started in, and `@@`, which the title runs on into.
		const list: Held[] = $state(
			opened("[a]: /u\n    'code\n@@\ntext\n").children.map((n) => ({ ...n }))
		);
		const readings = unfinishedReadings(defaultGrammarView);
		expect(waitingInto((i) => list[i], 2, 0, readings)).toBe(0);
		expect(differences(list, readings)).toEqual([]);
		testLeaf('at-line', {
			opener: { priority: 0, tryOpen: () => null, interruptsParagraph: (line) => line === '@@' }
		});
		expect(waitingInto((i) => list[i], 2, 0, readings)).toBe(-1);
		expect(differences(list, readings)).toEqual([]);
	});
});

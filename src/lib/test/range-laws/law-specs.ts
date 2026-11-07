// Each law as one property: what it draws and the run that judges a draw. The gated suite and the
// report run read this one table, so the two can't drift.

import fc from 'fast-check';
import {
	law1,
	law2,
	law3,
	law4,
	law5,
	law9,
	law10,
	law11,
	afterGesture,
	type AnyGesture,
	type CaretInput,
	type LawInput,
	type LawRun,
	type Replacement
} from './laws';
import { CLIPBOARD_ROUTES, PASTE_ROUTES, TYPING_ROUTES, type TypedKey } from './gestures';
import { arbClipboardText, arbLawDocument, arbMode } from './shapes';
import { arbEnd, arbRangeSeed } from './ranges';

export interface LawSpec {
	law: string;
	name: string;
	// Each spec draws its own argument shape, which `run` alone reads.
	arb: fc.Arbitrary<any>;
	run(args: any): Promise<LawRun>;
	/** Fixed draws in `arb`'s shape that keep the law today, each reaching a clause the gated seed's
	 *  few draws can miss; the gated suite runs them first. */
	examples?: readonly unknown[];
}

const end = (site: number, at: 'start' | 'end' | 'inside', inside = 0) => ({ site, at, inside });

/** `one\n\ntwo\n` selected over `ne`, the blank line and `tw`. */
const ACROSS_PARAGRAPHS = {
	source: 'one\n\ntwo\n',
	mode: 'source',
	seed: { a: end(0, 'inside', 0), b: end(1, 'inside', 1) }
} as const;

const AT_ALPHA_2 = { source: 'alpha\n', mode: 'source', caret: end(0, 'inside', 1) } as const;

const arbInput: fc.Arbitrary<LawInput> = fc.record({
	source: arbLawDocument,
	mode: arbMode,
	seed: arbRangeSeed
});
const arbCaretInput = fc.record({ source: arbLawDocument, mode: arbMode, caret: arbEnd });
const clipboardRoute = fc.constantFrom(...CLIPBOARD_ROUTES);
const pasteRoute = fc.constantFrom(...PASTE_ROUTES);

const arbTyped: fc.Arbitrary<TypedKey> = fc.oneof(
	fc.record({
		text: fc.constantFrom('x', '#', '>', ' ', '-'),
		route: fc.constantFrom(...TYPING_ROUTES)
	}),
	fc.constant({ key: 'Enter' as const })
);
const arbReplacement: fc.Arbitrary<Replacement> = fc.oneof(
	fc.record({ typed: arbTyped }),
	fc.record({ pasted: arbClipboardText, route: pasteRoute })
);
const arbGesture: fc.Arbitrary<AnyGesture> = fc.oneof(
	fc.record({ cut: clipboardRoute }),
	fc.record({ replacement: arbReplacement }),
	fc.record({ deleted: fc.constantFrom<'Backspace' | 'Delete'>('Backspace', 'Delete') }),
	fc.record({ plain: arbClipboardText })
);

/** A gesture over a range, or a paste at a caret, where undo must put the caret back where it began. */
const arbAnyGesture = fc.oneof(
	fc.tuple(arbInput, arbGesture),
	fc.tuple(
		arbCaretInput,
		fc.record({ replacement: fc.record({ pasted: arbClipboardText, route: pasteRoute }) })
	)
);

/** Text that is one block, or none: what law 11 pastes, since a blank line can't read as text. */
const arbPlainText = arbClipboardText.filter((text) => !/\n\s*\n/.test(text.trim()));

// Laws 7 and 8 judge the same runs, so the second reads the first's from here, fixed draws too.
const GESTURE_EXAMPLES = [
	// The menu's paste has no keydown to record undo's caret, so the paste must.
	[AT_ALPHA_2, { replacement: { pasted: 'xyz', route: 'menu' } }],
	[
		{ source: '> one\n> two\n\nthree\n', mode: 'source', caret: end(0, 'inside', 1) },
		{ replacement: { pasted: 'x\ny', route: 'key' } }
	],
	[ACROSS_PARAGRAPHS, { cut: 'key' }]
];
const gestureRuns = new Map<string, Promise<LawRun>>();
const memoGesture = ([input, g]: [LawInput | CaretInput, AnyGesture]) => {
	const key = JSON.stringify([input, g]);
	if (!gestureRuns.has(key)) gestureRuns.set(key, afterGesture(input, g));
	return gestureRuns.get(key)!;
};

export const LAW_SPECS: readonly LawSpec[] = [
	{
		law: 'L1',
		name: 'copy and cut write the same clipboard',
		arb: fc.tuple(arbInput, clipboardRoute, clipboardRoute),
		run: ([input, copy, cut]) => law1(input, copy, cut),
		examples: [[ACROSS_PARAGRAPHS, 'key', 'key at body']]
	},
	{
		law: 'L2',
		name: 'copy changes nothing',
		arb: fc.tuple(arbInput, clipboardRoute),
		run: ([input, copy]) => law2(input, copy)
	},
	{
		law: 'L3',
		name: 'cut, then paste at the caret it left, gives the source back',
		arb: fc.tuple(arbInput, clipboardRoute, pasteRoute),
		run: ([input, cut, paste]) => law3(input, cut, paste),
		examples: [
			[
				{
					source: 'alpha bravo\n',
					mode: 'source',
					seed: { a: end(0, 'inside', 4), b: end(0, 'inside', 8) }
				},
				'key',
				'key'
			]
		]
	},
	{
		law: 'L4',
		name: 'Backspace and Delete over a range leave what a cut leaves',
		arb: fc.tuple(arbInput, fc.constantFrom<'Backspace' | 'Delete'>('Backspace', 'Delete')),
		run: ([input, key]) => law4(input, key),
		examples: [
			[ACROSS_PARAGRAPHS, 'Backspace'],
			[{ ...ACROSS_PARAGRAPHS, source: '> one\n\ntwo\n' }, 'Delete']
		]
	},
	{
		law: 'L5',
		name: 'typing or pasting over a range is a cut, then the key or paste',
		arb: fc.tuple(arbInput, arbReplacement),
		run: ([input, r]) => law5(input, r)
	},
	{
		law: 'L7',
		name: 'one gesture is one undo entry',
		arb: arbAnyGesture,
		run: memoGesture,
		examples: GESTURE_EXAMPLES
	},
	{
		law: 'L8',
		name: 'after every gesture the tree is a reload of its bytes',
		arb: arbAnyGesture,
		run: memoGesture,
		examples: GESTURE_EXAMPLES
	},
	{
		law: 'L9',
		name: 'a paste inserts its bytes at the caret',
		arb: fc.tuple(arbCaretInput, arbClipboardText, pasteRoute),
		run: ([input, text, paste]) => law9(input, text, paste),
		// Text with a line break into a quote and a list item, where each new line takes a prefix.
		examples: [
			[{ source: '> alpha\n', mode: 'source', caret: end(0, 'end') }, 'one\ntwo', 'key'],
			[{ source: '- alpha\n', mode: 'source', caret: end(0, 'end') }, 'one\ntwo', 'menu']
		]
	},
	{
		law: 'L10',
		name: 'container markers travel with the lines they mark',
		arb: fc.tuple(arbInput, clipboardRoute),
		run: ([input, copy]) => law10(input, copy),
		examples: [
			[
				{
					source: 'alpha\n\n> one\n> two\n',
					mode: 'source',
					seed: { a: end(0, 'inside', 1), b: end(1, 'inside', 1) }
				},
				'key'
			]
		]
	},
	{
		law: 'L11',
		name: 'Paste as plain text never converts',
		arb: fc.tuple(arbCaretInput, arbPlainText),
		run: ([input, text]) => law11(input, text),
		examples: [[{ ...AT_ALPHA_2, caret: end(0, 'end') }, '# not *a* heading']]
	}
];

/** Whether `line` is about `law` itself (a sub-label included), not one of its post-conditions. */
export const isLawLine = (law: string, line: string) =>
	line.startsWith(`${law} `) || line.startsWith(`${law}.`);

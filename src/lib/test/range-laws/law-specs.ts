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
}

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

// Laws 7 and 8 judge the same runs, so the second reads the first's from here.
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
		run: ([input, copy, cut]) => law1(input, copy, cut)
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
		run: ([input, cut, paste]) => law3(input, cut, paste)
	},
	{
		law: 'L4',
		name: 'Backspace and Delete over a range leave what a cut leaves',
		arb: fc.tuple(arbInput, fc.constantFrom<'Backspace' | 'Delete'>('Backspace', 'Delete')),
		run: ([input, key]) => law4(input, key)
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
		run: memoGesture
	},
	{
		law: 'L8',
		name: 'after every gesture the tree is a reload of its bytes',
		arb: arbAnyGesture,
		run: memoGesture
	},
	{
		law: 'L9',
		name: 'a paste inserts its bytes at the caret',
		arb: fc.tuple(arbCaretInput, arbClipboardText, pasteRoute),
		run: ([input, text, paste]) => law9(input, text, paste)
	},
	{
		law: 'L10',
		name: 'container markers travel with the lines they mark',
		arb: fc.tuple(arbInput, clipboardRoute),
		run: ([input, copy]) => law10(input, copy)
	},
	{
		law: 'L11',
		name: 'Paste as plain text never converts',
		arb: fc.tuple(arbCaretInput, arbPlainText),
		run: ([input, text]) => law11(input, text)
	}
];

/** Whether `line` is about `law` itself (a sub-label included), not one of its post-conditions. */
export const isLawLine = (law: string, line: string) =>
	line.startsWith(`${law} `) || line.startsWith(`${law}.`);

// @vitest-environment jsdom
// Every function that reads a math block's opener, body and closer, over the same shapes, held to
// one split: `readMathSource` for `$$`, the code fence's own for ```math. The parser's side reads a
// block's stored bytes, its line ending kept; the painter's side reads the source being edited.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib';
import {
	fenceBodyAsDrawn,
	firstLineEnding,
	isBlankText,
	sliceFencedSource,
	trimTrailingLineEnding,
	trimWhitespace,
	type LineEnding
} from '#lib/plugin.js';
import { tryGetBlockKindDescriptor } from '#lib/schema/block-kind-descriptor.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { MATH_BLOCK, registerMathBlock } from '#lib/plugins/latex/latex-kind.js';
import {
	mathBodySpan,
	mathDisplaySource,
	renderMathSource,
	reshapeMathEdit
} from '#lib/plugins/latex/math-source.js';
import {
	awaitsMathCloser,
	readMathSource,
	type MathSource
} from '#lib/plugins/latex/math-shape.js';
import { paintedSplit } from './painted-split';

beforeEach(registerMathBlock);

interface Shape {
	label: string;
	/** The source as the block shows it while edited: no line ending after its last line. */
	text: string;
	/** The split the block's own form gives `text`. */
	split: MathSource | null;
	/** Whether the parser reads `text` plus a line ending as one math block from line 0. */
	block: boolean;
	eol: LineEnding;
}

const parts = (opener: string, body: string, closer: string, after = ''): MathSource => ({
	opener,
	body,
	closer,
	after
});

type Row = [
	label: string,
	text: string,
	split: MathSource | null,
	block: boolean,
	eol?: LineEnding
];

const shapes = (rows: Row[]): Shape[] =>
	rows.map(([label, text, split, block, eol]) => ({
		label,
		text,
		split,
		block,
		eol: eol ?? firstLineEnding(text) ?? '\n'
	}));

const DOLLAR_SHAPES = shapes([
	['closed multi-line', '$$\nx^2\n$$', parts('$$\n', 'x^2\n', '$$'), true],
	['unclosed multi-line', '$$\nx^2', parts('$$\n', 'x^2', ''), false],
	['unclosed, CRLF', '$$\r\nx^2', parts('$$\r\n', 'x^2', ''), false],
	['one-line', '$$x^2$$', parts('$$', 'x^2', '$$'), true],
	['one-line with padding', '$$ x^2 $$', parts('$$', ' x^2 ', '$$'), true],
	['one-line, emptied', '$$$$', parts('$$', '', '$$'), true],
	['one-line, emptied, CRLF', '$$$$', parts('$$', '', '$$'), true, '\r\n'],
	['opener over its closer', '$$\n$$', parts('$$\n', '', '$$'), true],
	['a blank body line', '$$\n\n$$', parts('$$\n', '\n', '$$'), true],
	['a blank line inside the body', '$$\nx\n\ny\n$$', parts('$$\n', 'x\n\ny\n', '$$'), true],
	['a lone fence line', '$$', parts('$$', '', ''), false],
	['a lone fence line, CRLF', '$$', parts('$$', '', ''), false, '\r\n'],
	['text on the opener line, unclosed', '$$ x\ny', parts('$$', ' x\ny', ''), false],
	['opener with a trailing space', '$$ \nx^2\n$$', parts('$$', ' \nx^2\n', '$$'), false],
	['opener indented one space', ' $$\nx^2\n$$', null, false],
	['opener indented three spaces', '   $$\nx^2\n$$', null, false],
	['opener indented four spaces', '    $$\nx^2\n$$', null, false],
	// Edited, a source ending `$$` reads as a one-line form a line break went into; stored with
	// its line ending, the same bytes are an opener still waiting for its closer.
	['closer indented', '$$\nx^2\n $$', parts('$$', '\nx^2\n ', '$$'), false],
	['closer with trailing spaces', '$$\nx^2\n$$  ', parts('$$\n', 'x^2\n$$  ', ''), false],
	['CRLF', '$$\r\nx^2\r\n$$', parts('$$\r\n', 'x^2\r\n', '$$'), true],
	['text after the closer', '$$\nx^2\n$$\ny', parts('$$\n', 'x^2\n', '$$', '\ny'), true],
	['text after a one-line block', '$$x$$\ny', parts('$$', 'x', '$$', '\ny'), true],
	['not math', 'loose prose', null, false]
]);

const FENCE_SHAPES = shapes([
	['```math', '```math\nx^2\n```', parts('```math\n', 'x^2\n', '```'), true],
	[
		'```math with more info',
		'```math linenums\nx\n```',
		parts('```math linenums\n', 'x\n', '```'),
		true
	],
	['~~~math', '~~~math\n\\alpha\n~~~', parts('~~~math\n', '\\alpha\n', '~~~'), true],
	['```math over its closer', '```math\n```', parts('```math\n', '', '```'), true],
	['```math, CRLF', '```math\r\nx^2\r\n```', parts('```math\r\n', 'x^2\r\n', '```'), true]
]);

// ── Each route's view of the split ───────────────────────────────────────────

const MATH_FIXTURE = '$$\nx\n$$';

/** The `$$` kind's write rule, as a blur writes an edited source. */
function blurWrite(text: string, eol: LineEnding): string {
	const doc = parse(MATH_FIXTURE + eol);
	return trimTrailingLineEnding(legalizeWrite(doc, 0, text + eol, 'authored').text);
}

function writeRuleText(raw: string, eol: LineEnding): string {
	const [node] = parse(MATH_FIXTURE + eol).children;
	return tryGetBlockKindDescriptor(node.kind)!.rawWrite!.text!(raw);
}

/** A closed source whose body has no line to put a caret on: the edit gives it one. */
const isBare = (source: MathSource | null): boolean =>
	source !== null &&
	source.closer !== '' &&
	!source.body.includes('\n') &&
	isBlankText(source.body);

const BOTH_FORMS = [...DOLLAR_SHAPES, ...FENCE_SHAPES];
const DOLLAR_SOURCES = DOLLAR_SHAPES.filter((shape) => shape.split !== null);

type Route = [name: string, check: (shape: Shape) => void, shapes: Shape[]];

const ROUTES: Route[] = [
	[
		'the parser',
		({ text, eol, block }) => {
			const stored = readMathSource(text + eol);
			expect(stored !== null && stored.closer !== '', 'the stored split closes').toBe(block);
			const [first] = parse(text + eol).children;
			expect(first.kind === MATH_BLOCK, 'a math block opens on line 0').toBe(block);
			if (stored && block) {
				expect(trimTrailingLineEnding(first.raw)).toBe(stored.opener + stored.body + stored.closer);
			}
		},
		DOLLAR_SHAPES
	],
	[
		'the check for a reading more lines could change',
		({ text, eol }) => {
			const stored = readMathSource(text + eol);
			const awaits = stored !== null && stored.closer === '' && stored.opener.endsWith('\n');
			expect(awaitsMathCloser(text + eol)).toBe(awaits);
		},
		DOLLAR_SHAPES
	],
	[
		'the write rule’s text',
		({ text, eol }) => {
			const stored = readMathSource(text + eol);
			expect(writeRuleText(text + eol, eol)).toBe(stored ? stored.body + stored.after : text + eol);
		},
		DOLLAR_SHAPES
	],
	[
		'the blur’s write',
		({ text, eol, split }) => {
			const shown = reshapeMathEdit(text, 0, eol)?.text ?? text;
			const written = readMathSource(blurWrite(shown, eol));
			expect(written?.closer, 'the written source closes').toBe('$$');
			expect(written && fenceBodyAsDrawn(written)).toBe(fenceBodyAsDrawn(readMathSource(shown)!));
			expect(written?.after).toBe(split!.after);
		},
		DOLLAR_SOURCES
	],
	[
		'the painter',
		({ text, split }) => {
			expect(renderMathSource(text).textContent).toBe(text);
			expect(paintedSplit(text)).toEqual(split && { ...split, body: fenceBodyAsDrawn(split) });
		},
		BOTH_FORMS
	],
	[
		'the body span',
		({ text, split }) => {
			const { start, end } = mathBodySpan(text);
			expect(start).toBe(split?.opener.length ?? 0);
			expect(text.slice(start, end)).toBe(split ? fenceBodyAsDrawn(split) : text);
		},
		BOTH_FORMS
	],
	[
		'the rendered formula',
		({ text, split }) => {
			expect(mathDisplaySource(text)).toBe(trimWhitespace(split?.body ?? text));
		},
		BOTH_FORMS
	],
	[
		'the edit’s reshape',
		({ text, eol, split }) => {
			const edit = reshapeMathEdit(text, 0, eol);
			const holdsBreak =
				split?.opener === '$$' && split.closer === '$$' && split.body.includes('\n');
			expect(edit !== null, 'the edit reshapes the source').toBe(isBare(split) || holdsBreak);
			if (!edit) return;
			const shown = readMathSource(edit.text) ?? sliceFencedSource(edit.text);
			expect(shown?.closer).toBe(split!.closer);
			// A bare block gains one empty body line; any other reshape keeps every body byte.
			if (isBare(split)) expect(shown?.body).toMatch(/^\r?\n$/);
			else expect(shown && fenceBodyAsDrawn(shown)).toBe(split!.body);
		},
		BOTH_FORMS
	]
];

// ── Rows ─────────────────────────────────────────────────────────────────────

describe('the $$ split', () => {
	for (const { label, text, split: expected } of DOLLAR_SHAPES) {
		it(label, () => {
			expect(readMathSource(text)).toEqual(expected);
		});
	}
});

describe('the ```math split is the code fence’s', () => {
	for (const { label, text, split: expected } of FENCE_SHAPES) {
		it(label, () => {
			expect(readMathSource(text)).toBeNull();
			expect({ ...sliceFencedSource(text), after: '' }).toEqual(expected);
		});
	}
});

for (const [route, check, population] of ROUTES) {
	describe(`${route} reads the split`, () => {
		for (const shape of population) {
			it(`${shape.label} (${JSON.stringify(shape.text)})`, () => check(shape));
		}
	});
}

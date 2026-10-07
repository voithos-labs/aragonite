// @vitest-environment jsdom
// Every reader of a math block's opener, body and closer, over the same shapes, held to the one
// split: `readMathSource` for `$$`, the code fence's own for ```math. The parser's side reads a
// block's stored bytes, its line ending kept; the painter's side reads the source being edited.
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from '$lib';
import {
	fenceBodyAsDrawn,
	firstLineEnding,
	isBlankText,
	sliceFencedSource,
	trimTrailingLineEnding,
	trimWhitespace,
	type LineEnding
} from '$lib/plugin';
import { tryGetBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { MATH_BLOCK, registerMathBlock } from '$lib/plugins/latex/latex-kind';
import {
	mathBodySpan,
	mathDisplaySource,
	renderMathSource,
	reshapeMathEdit
} from '$lib/plugins/latex/math-source';
import { awaitsMathCloser, readMathSource, type MathSource } from '$lib/plugins/latex/math-shape';

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
	['one-line', '$$x^2$$', parts('$$', 'x^2', '$$'), true],
	['one-line with padding', '$$ x^2 $$', parts('$$', ' x^2 ', '$$'), true],
	['one-line, emptied', '$$$$', parts('$$', '', '$$'), true],
	['one-line, emptied, CRLF', '$$$$', parts('$$', '', '$$'), true, '\r\n'],
	['opener over its closer', '$$\n$$', parts('$$\n', '', '$$'), true],
	['a blank body line', '$$\n\n$$', parts('$$\n', '\n', '$$'), true],
	['a blank line inside the body', '$$\nx\n\ny\n$$', parts('$$\n', 'x\n\ny\n', '$$'), true],
	['a lone fence line', '$$', parts('$$', '', ''), false],
	['text on the opener line, unclosed', '$$ x\ny', parts('$$', ' x\ny', ''), false],
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

// ── Each reader's view of the split ──────────────────────────────────────────

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

/** The opener, closer and trailing text the painter draws, read off its fence-line markers. */
function paintedSplit(text: string): Omit<MathSource, 'body'> | null {
	const nodes = Array.from(renderMathSource(text).childNodes);
	const fenceAt = nodes.flatMap((node, i) =>
		node instanceof Element && node.classList.contains('md-fence-line') ? [i] : []
	);
	if (fenceAt.length === 0) return null;
	const opener = fenceAt[0] === 0 ? (nodes[0].textContent ?? '') : '';
	const closerAt = fenceAt.find((i) => i > 0);
	const closerLine = closerAt === undefined ? null : (nodes[closerAt] as Element);
	const markers = closerLine?.querySelectorAll('.md-marker') ?? [];
	const past = closerAt === undefined ? [] : nodes.slice(closerAt + 1);
	return {
		opener,
		closer: markers.length > 0 ? (markers[markers.length - 1].textContent ?? '') : '',
		after: past.map((node) => node.textContent).join('')
	};
}

/** A closed source whose body has no line to put a caret on: the edit gives it one. */
const isBare = (source: MathSource | null): boolean =>
	source !== null &&
	source.closer !== '' &&
	!source.body.includes('\n') &&
	isBlankText(source.body);

const BOTH_FORMS = [...DOLLAR_SHAPES, ...FENCE_SHAPES];
const DOLLAR_SOURCES = DOLLAR_SHAPES.filter((shape) => shape.split !== null);

type Reader = [name: string, check: (shape: Shape) => void, shapes: Shape[]];

const READERS: Reader[] = [
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
			const written = readMathSource(blurWrite(text, eol));
			expect(written?.closer, 'the written source closes').toBe('$$');
			expect(written && fenceBodyAsDrawn(written)).toBe(fenceBodyAsDrawn(split!));
			expect(written?.after).toBe(split!.after);
		},
		DOLLAR_SOURCES
	],
	[
		'the painter',
		({ text, split }) => {
			expect(renderMathSource(text).textContent).toBe(text);
			const expected = split && { opener: split.opener, closer: split.closer, after: split.after };
			expect(paintedSplit(text)).toEqual(expected);
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
			if (isBare(split)) {
				const completed = edit && (readMathSource(edit.text) ?? sliceFencedSource(edit.text));
				expect(completed?.closer).toBe(split!.closer);
				expect(completed?.body).toMatch(/^\r?\n$/);
				return;
			}
			const shown = edit ? (readMathSource(edit.text) ?? sliceFencedSource(edit.text)) : split;
			expect(shown && fenceBodyAsDrawn(shown)).toBe(split && fenceBodyAsDrawn(split));
			expect(shown?.closer).toBe(split?.closer);
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

for (const [reader, check, population] of READERS) {
	describe(`${reader} reads the split`, () => {
		for (const shape of population) {
			it(`${shape.label} (${JSON.stringify(shape.text)})`, () => check(shape));
		}
	});
}

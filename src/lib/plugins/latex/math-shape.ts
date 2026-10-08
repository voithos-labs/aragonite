/**
 * How a `$$` block's source reads as an opener, a body and a closer: the one reading the parser's
 * line tests, the write rule and the painter share, so a source shown while it's edited is the
 * block its bytes reload as. A one-line `$$x^2$$` that takes a line break is the multi-line form.
 */

import { displayLines, firstLineEnding, type FencedSource, type LineEnding } from '#lib/plugin.js';

type Line = ReturnType<typeof displayLines>[number];

const BLOCK_FENCE = '$$';

/** A source read as a block, plus the text past its closer, which the parser reads on its own. */
export interface MathSource extends FencedSource {
	after: string;
}

/** Text with a caret in it. */
export interface MathEdit {
	text: string;
	caret: number;
}

// ── The parser's line tests ────────────────────────────────────────────────

/** The multi-line form's opener or closer: the fence and nothing else. */
export const isMathFenceLine = (text: string): boolean => text === BLOCK_FENCE;

/** A whole block on one line; at four characters or more, its two fences can't overlap. */
const isOneLineMath = (text: string): boolean =>
	text.length >= 4 && text.startsWith(BLOCK_FENCE) && text.endsWith(BLOCK_FENCE);

export const opensMathBlock = (text: string): boolean =>
	isOneLineMath(text) || isMathFenceLine(text);

/** The index of the line closing the block `lines[from]` opens: `from` itself for a one-line
 *  block, -1 when that line opens none or no line before `end` closes it. */
export function mathCloserLine(
	lines: readonly { text: string }[],
	from: number,
	end: number
): number {
	const opener = lines[from].text;
	if (isOneLineMath(opener)) return from;
	if (!isMathFenceLine(opener)) return -1;
	for (let i = from + 1; i < end; i++) if (isMathFenceLine(lines[i].text)) return i;
	return -1;
}

/** A lone `$$` line no later line closes: a paragraph now, which a closer typed below turns into
 *  math. */
export function awaitsMathCloser(raw: string): boolean {
	if (!raw.startsWith(BLOCK_FENCE)) return false;
	const lines = displayLines(raw);
	return isMathFenceLine(lines[0].text) && mathCloserLine(lines, 0, lines.length) === -1;
}

/** The multi-line form's lines around `body`, the shape every writer of a new block gives it. */
export const mathBlockLines = (body: string): string[] => [BLOCK_FENCE, body, BLOCK_FENCE];

// ── The reading ────────────────────────────────────────────────────────────

/** Line 0 decides, as for the parser: a one-line block, or a fence line a later one closes. Else
 *  a source ending `$$` is a one-line form holding a line break, and one that doesn't is open. */
export function readMathSource(text: string): MathSource | null {
	if (!text.startsWith(BLOCK_FENCE)) return null;
	const lines = displayLines(text);
	const [first] = lines;
	const closer = mathCloserLine(lines, 0, lines.length);
	if (closer === 0) return cut(text, BLOCK_FENCE.length, first.text.length - BLOCK_FENCE.length);
	const bodyStart = isMathFenceLine(first.text)
		? first.text.length + first.ending.length
		: BLOCK_FENCE.length;
	if (closer > 0) return cut(text, bodyStart, lineStart(lines, closer));
	if (text.length >= 4 && text.endsWith(BLOCK_FENCE)) {
		return cut(text, BLOCK_FENCE.length, text.length - BLOCK_FENCE.length);
	}
	return { opener: text.slice(0, bodyStart), body: text.slice(bodyStart), closer: '', after: '' };
}

/** A one-line source a line break went into, as the multi-line form; null for any other. */
export function reshapeMathSource(text: string, caret: number): MathEdit | null {
	const source = readMathSource(text);
	if (!source || source.opener !== BLOCK_FENCE || source.closer !== BLOCK_FENCE) return null;
	const ending = firstLineEnding(source.body);
	return ending ? onOwnLines(source.body, caret, ending) : null;
}

/** A source made legal as bytes: reshaped, closed, and rid of a lone fence line past the block. A
 *  literal write's lines stay their own blocks unless the last one is exactly `$$`. */
export function legalMathSource(
	text: string,
	caret: number,
	write: { authored: boolean; closerEnding: LineEnding }
): MathEdit {
	const joined = !write.authored && broughtLines(text);
	if (joined) return withoutStrandedFence(closedOnLineZero(text, caret));
	const reshaped = reshapeMathSource(text, caret) ?? { text, caret };
	return withoutStrandedFence(withCloser(reshaped, write.closerEnding));
}

// ── Internal ───────────────────────────────────────────────────────────────

function cut(text: string, bodyStart: number, closerStart: number): MathSource {
	const closerEnd = closerStart + BLOCK_FENCE.length;
	return {
		opener: text.slice(0, bodyStart),
		body: text.slice(bodyStart, closerStart),
		closer: text.slice(closerStart, closerEnd),
		after: text.slice(closerEnd)
	};
}

function lineStart(lines: readonly Line[], index: number): number {
	let offset = 0;
	for (let i = 0; i < index; i++) offset += lines[i].text.length + lines[i].ending.length;
	return offset;
}

/** `body` between fence lines of their own, the caret moved past each ending put in before it. */
function onOwnLines(body: string, caret: number, ending: LineEnding): MathEdit {
	const bodyStart = BLOCK_FENCE.length;
	const bodyEnd = bodyStart + body.length;
	const shift = caret < bodyStart ? 0 : caret <= bodyEnd ? ending.length : 2 * ending.length;
	return { text: mathBlockLines(body).join(ending), caret: caret + shift };
}

/** Line 0 opens `$$` but isn't a whole block or a fence line, and the last line isn't the closer. */
function broughtLines(text: string): boolean {
	const lines = displayLines(text);
	const [first] = lines;
	return (
		lines.length > 1 &&
		first.text.startsWith(BLOCK_FENCE) &&
		!opensMathBlock(first.text) &&
		!isMathFenceLine(lines[lines.length - 1].text)
	);
}

function closedOnLineZero(text: string, caret: number): MathEdit {
	const lineEnd = displayLines(text)[0].text.length;
	return {
		text: text.slice(0, lineEnd) + BLOCK_FENCE + text.slice(lineEnd),
		caret: caret > lineEnd ? caret + BLOCK_FENCE.length : caret
	};
}

/** An unclosed source with its closer back; the one-liner a typed line break opened up gets its
 *  closer on a line of its own. */
function withCloser({ text, caret }: MathEdit, closerEnding: LineEnding): MathEdit {
	const source = readMathSource(text);
	if (!source || source.closer) return { text, caret };
	const lines = displayLines(text);
	// The closer line goes in after every written byte, so no offset moves.
	if (isMathFenceLine(lines[0].text)) return { text: text + closerEnding + BLOCK_FENCE, caret };
	if (lines.length === 1) return { text: text + BLOCK_FENCE, caret };
	return onOwnLines(source.body, caret, lines[0].ending as LineEnding);
}

/** Drops the fence line past the block that no later one pairs with: as text, it would open a
 *  block running to the next `$$` anywhere below. */
function withoutStrandedFence({ text, caret }: MathEdit): MathEdit {
	const lines = displayLines(text);
	const source = readMathSource(text);
	const blockEnd = source ? text.length - source.after.length : 0;
	let open = -1;
	for (let i = 0, offset = 0; i < lines.length; i++) {
		if (offset >= blockEnd && isMathFenceLine(lines[i].text)) open = open === -1 ? i : -1;
		offset += lines[i].text.length + lines[i].ending.length;
	}
	return open === -1 ? { text, caret } : withoutLine(lines, open, caret);
}

/** The lines with one removed; the last line takes the ending above it along. */
function withoutLine(lines: Line[], index: number, caret: number): MathEdit {
	let from = lineStart(lines, index);
	let to = from + lines[index].text.length + lines[index].ending.length;
	if (index === lines.length - 1 && index > 0) {
		from -= lines[index - 1].ending.length;
		to = from + lines[index - 1].ending.length + lines[index].text.length;
	}
	const text = lines.map((line) => line.text + line.ending).join('');
	const moved = caret <= from ? caret : Math.max(from, caret - (to - from));
	return { text: text.slice(0, from) + text.slice(to), caret: moved };
}

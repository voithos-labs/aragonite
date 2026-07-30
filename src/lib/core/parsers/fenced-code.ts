import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';

/**
 * The recognizer-grade fence-open shape, re-exported on `aragonite/plugin` for
 * fence-claiming openers: `info` is the trimmed dispatch string; `indent` and
 * `infoRaw` are the verbatim bytes a byte-exact rebuild needs.
 */
export interface FenceOpen {
	marker: '`' | '~';
	length: number;
	info: string;
	indent: string;
	infoRaw: string;
}

// Backtick info may not contain backticks (CommonMark §4.5); tilde info may.
const BACKTICK_OPEN = /^( {0,3})(`{3,})([^`]*)$/;
const TILDE_OPEN = /^( {0,3})(~{3,})(.*)$/;

export function matchFenceOpen(text: string): FenceOpen | null {
	const m = text.match(BACKTICK_OPEN) ?? text.match(TILDE_OPEN);
	if (!m) return null;
	const [, indent, fence, infoRaw] = m;
	return {
		marker: fence[0] as '`' | '~',
		length: fence.length,
		info: infoRaw.trim(),
		indent,
		infoRaw
	};
}

export function matchFenceClose(text: string, marker: '`' | '~', minLength: number): boolean {
	const pattern = marker === '`' ? /^ {0,3}(`{3,})\s*$/ : /^ {0,3}(~{3,})\s*$/;
	const m = text.match(pattern);
	return Boolean(m && m[1].length >= minLength);
}

/**
 * The fence length a block needs to wrap `body` — one past every body line the
 * parser would read as this block's closer, never below `minimum`. The write-side
 * inverse of `matchFenceClose`, and the sibling of `escalatedColonCount` for
 * directives: without it a body line reproducing the terminator closes the block
 * early and everything below it is ejected on reparse.
 *
 * A floor, not a target: it never shortens a fence, so a block whose colliding line
 * goes away keeps the wider run until a reparse reads it as the new floor.
 */
export function escalatedFenceLength(body: string, marker: '`' | '~', minimum: number): number {
	let required = minimum;
	for (const line of body.split('\n')) {
		// Splitting on `\n` leaves a CRLF body's `\r` on each segment's tail; a closer
		// line's text excludes it, so the run test must too.
		const text = line.endsWith('\r') ? line.slice(0, -1) : line;
		if (matchFenceClose(text, marker, required)) required = fenceRunLength(text, marker) + 1;
	}
	return required;
}

/** The marker run at the head of a line, past any indentation. */
function fenceRunLength(text: string, marker: '`' | '~'): number {
	let index = 0;
	while (text[index] === ' ') index++;
	let run = 0;
	while (text[index + run] === marker) run++;
	return run;
}

export function parseFencedCode(
	lines: ParsedLine[],
	startIndex: number,
	endIndex: number,
	leadingTrivia: string,
	fence: { marker: '`' | '~'; length: number; info: string }
): BlockOpenerResult {
	let i = startIndex + 1;
	let closed = false;

	while (i < endIndex) {
		if (matchFenceClose(lines[i].text, fence.marker, fence.length)) {
			i++;
			closed = true;
			break;
		}
		i++;
	}

	const raw = joinRaw(lines, startIndex, i);
	return {
		node: {
			kind: 'fencedCode',
			leadingTrivia,
			raw,
			metadata: {
				fenceMarker: fence.marker,
				fenceLength: fence.length,
				info: fence.info,
				closed
			}
		},
		consumed: i - startIndex
	};
}

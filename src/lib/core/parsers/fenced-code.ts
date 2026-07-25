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

/**
 * Fenced code block parser. Matches ``` and ~~~ fences, scans until a
 * matching close fence or EOF.
 */

import type { CstNode } from '../nodes';
import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';

export function matchFenceOpen(text: string): { marker: '`' | '~'; length: number; info: string } | null {
	const m = text.match(/^ {0,3}(`{3,})([^`]*)$|^ {0,3}(~{3,})(.*)$/);
	if (!m) return null;

	if (m[1]) {
		return { marker: '`', length: m[1].length, info: m[2].trim() };
	}
	return { marker: '~', length: m[3].length, info: m[4].trim() };
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
): { node: CstNode; nextIndex: number } {
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
		nextIndex: i
	};
}

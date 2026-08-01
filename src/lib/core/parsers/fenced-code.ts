import type { ParsedLine } from '../lines';
import { joinRaw } from '../parser';
import type { BlockOpenerResult } from '../../schema/block-openers';
import { matchFenceClose } from './fence-syntax';

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

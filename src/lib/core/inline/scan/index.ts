/**
 * scanInline — single-pass inline scanner (the CommonMark reference
 * architecture), the staged pipeline's cutover replacement. Same contract as
 * parseInline: InlineNode[] with absolute offsets into raw, total coverage
 * of [start, end). Nothing outside scan/ and its tests may import this until
 * cutover.
 */

import type { InlineNode } from '../../nodes';
import type { LinkReferenceResolver } from '../link-reference-resolver';
import { mergeAdjacentText } from '../post-process';
import { handleBacktick } from './code-spans';
import { handleDelimiter, processEmphasis } from './emphasis';
import { createScanContext, flushPendingText } from './scan-state';
import { handleAmpersand, handleBackslash, handleNewline } from './simple-nodes';

// Every character that can start a construct or anchor a lookback: the
// dispatch cases below plus the characters later handlers claim (`[ <` fall
// through as text until then). `!` and `]` are deliberately absent — they
// only matter in ranges that also contain `[`. GFM bare/www autolinks
// trigger on plain text; their handler must extend this seam.
const SPECIAL_CHARS = '\\`&\n<[*_~';

const SPECIAL = new Uint8Array(128);
for (let i = 0; i < SPECIAL_CHARS.length; i++) SPECIAL[SPECIAL_CHARS.charCodeAt(i)] = 1;

/** Fast bail for the per-keystroke hot path: plain prose skips the scan loop. */
function hasSpecialChars(raw: string, start: number, end: number): boolean {
	for (let i = start; i < end; i++) {
		const code = raw.charCodeAt(i);
		if (code < 128 && SPECIAL[code] === 1) return true;
	}
	return false;
}

export function scanInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver
): InlineNode[] {
	if (start >= end) return [];
	if (!hasSpecialChars(raw, start, end)) {
		return [{ kind: 'text', start, end, text: raw.slice(start, end) }];
	}

	const ctx = createScanContext(raw, start, end, resolver);
	while (ctx.pos < ctx.end) {
		switch (raw[ctx.pos]) {
			case '\\':
				handleBackslash(ctx);
				break;
			case '`':
				handleBacktick(ctx);
				break;
			case '&':
				handleAmpersand(ctx);
				break;
			case '\n':
				handleNewline(ctx);
				break;
			case '*':
			case '_':
			case '~':
				handleDelimiter(ctx);
				break;
			default:
				ctx.pos++;
		}
	}
	flushPendingText(ctx, ctx.end);
	processEmphasis(ctx, 0);
	return mergeAdjacentText(ctx.nodes);
}

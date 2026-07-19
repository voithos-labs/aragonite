/**
 * scanInline — single-pass inline scanner (the CommonMark reference
 * architecture), exported as `parseInline` from ../index.ts. Contract:
 * InlineNode[] with absolute offsets into raw, total coverage of [start, end).
 */

import type { InlineNode } from '../../nodes';
import type { LinkReferenceResolver } from '../link-reference-resolver';
import { handleAngle, scanGfmAutolinks } from './autolinks';
import { handleBang, handleCloseBracket, handleOpenBracket } from './brackets';
import { handleBacktick } from './code-spans';
import { handleDelimiter, processEmphasis } from './emphasis';
import { appendNode, createScanContext, flushPendingText, mergeAdjacentText } from './scan-state';
import { handleAmpersand, handleBackslash, handleNewline } from './simple-nodes';
import { getInlineSyntax, hasInlineSyntax } from './plugin-syntax';

// Every character that can start a construct or anchor a lookback: the
// dispatch cases below plus `@` (GFM email lookback). `!` and `]` are
// deliberately absent — they only matter in ranges that also contain `[`.
const SPECIAL_CHARS = '\\`&\n<[*_~@';

// GFM bare http/www autolinks contain no character from the set above, so
// their starts get conditional probes instead of unconditional membership:
// `:` (too common in prose to forfeit the bail) counts only when `//`
// follows, `w`/`W` only when they complete a `www.` prefix. Each probe adds
// at most three comparisons at its trigger character; the lookahead may read
// past `end` and over-trigger, which costs one wasted scan, never a node.
const PROBE_SCHEME = 2;
const PROBE_WWW = 3;

const SPECIAL = new Uint8Array(128);
for (let i = 0; i < SPECIAL_CHARS.length; i++) SPECIAL[SPECIAL_CHARS.charCodeAt(i)] = 1;
SPECIAL[0x3a] = PROBE_SCHEME; // :
SPECIAL[0x57] = PROBE_WWW; // W
SPECIAL[0x77] = PROBE_WWW; // w

/** Fast bail for the per-keystroke hot path: plain prose skips the scan loop. */
function needsScan(raw: string, start: number, end: number): boolean {
	// Registered plugin triggers are held out of SPECIAL_CHARS, so probe them
	// only when something is registered — the empty registry stays byte-identical.
	const probePlugins = hasInlineSyntax();
	for (let i = start; i < end; i++) {
		const code = raw.charCodeAt(i);
		if (code >= 128) {
			if (probePlugins && getInlineSyntax(raw[i]) !== undefined) return true;
			continue;
		}
		const cls = SPECIAL[code];
		if (cls === 0) {
			if (probePlugins && getInlineSyntax(raw[i]) !== undefined) return true;
			continue;
		}
		if (cls === 1) return true;
		if (cls === PROBE_SCHEME) {
			if (raw.charCodeAt(i + 1) === 0x2f && raw.charCodeAt(i + 2) === 0x2f) return true; // ://
			if (probePlugins && getInlineSyntax(raw[i]) !== undefined) return true; // registered ':'
		} else {
			if (
				(raw.charCodeAt(i + 1) | 0x20) === 0x77 &&
				(raw.charCodeAt(i + 2) | 0x20) === 0x77 &&
				raw.charCodeAt(i + 3) === 0x2e
			) {
				return true; // www.
			}
			if (probePlugins && getInlineSyntax(raw[i]) !== undefined) return true; // registered 'w'/'W'
		}
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
	if (!needsScan(raw, start, end)) {
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
			case '[':
				handleOpenBracket(ctx);
				break;
			case ']':
				handleCloseBracket(ctx);
				break;
			case '!':
				handleBang(ctx);
				break;
			case '<':
				handleAngle(ctx);
				break;
			default: {
				if (hasInlineSyntax()) {
					const recognize = getInlineSyntax(raw[ctx.pos]);
					if (recognize) {
						const node = recognize(raw, ctx.pos, ctx.end);
						if (node) {
							// appendNode flushes pending text up to node.start and resumes at
							// node.end, so a node that starts anywhere but the cursor gaps or
							// overlaps coverage. Fail loud at the seam, not with a torn tree.
							if (node.start !== ctx.pos) {
								throw new Error(
									`inline-syntax "${raw[ctx.pos]}" started at ${node.start}, expected ${ctx.pos}`
								);
							}
							if (node.end <= ctx.pos) {
								throw new Error(`inline-syntax "${raw[ctx.pos]}" did not advance`);
							}
							appendNode(ctx, node);
							break;
						}
					}
				}
				ctx.pos++;
			}
		}
	}
	flushPendingText(ctx, ctx.end);
	// GFM bare autolinks claim their bytes before emphasis pairs: a delimiter
	// absorbed into a URL must not pair.
	scanGfmAutolinks(ctx);
	processEmphasis(ctx, 0);
	return mergeAdjacentText(ctx.nodes);
}

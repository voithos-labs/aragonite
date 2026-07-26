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
import {
	appendNode,
	createScanContext,
	flushPendingText,
	mergeAdjacentText,
	type ScanContext
} from './scan-state';
import { handleAmpersand, handleBackslash, handleNewline } from './simple-nodes';
import {
	getPrefixRungs,
	getUnreservedRungs,
	hasInlineSyntax,
	hasPrefixRungs,
	hasScanProbeRungs,
	isScanProbeTrigger,
	type InlineRung
} from './plugin-syntax';

// Every character that can start a construct or anchor a lookback: the
// dispatch cases below plus `@` (GFM email lookback). `!` and `]` are
// deliberately absent — they only matter in ranges that also contain `[`.
// A plugin rung can make `!` visible per registration (SCAN_PROBED_RESERVED in
// plugin-syntax.ts) rather than by joining this set, which would drag every
// prose `"Hello!"` through the scan loop for a syntax most documents never use.
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
	// The registry answers for both rung shapes through one hoisted flag and one
	// lookup, so an unregistered scan pays exactly the single always-false test per
	// character it paid before reserved `!` could be registered at all.
	const probePlugins = hasScanProbeRungs();
	for (let i = start; i < end; i++) {
		const code = raw.charCodeAt(i);
		if (code >= 128) {
			if (probePlugins && isScanProbeTrigger(raw[i])) return true;
			continue;
		}
		const cls = SPECIAL[code];
		if (cls === 0) {
			if (probePlugins && isScanProbeTrigger(raw[i])) return true; // registered '!' lands here
			continue;
		}
		if (cls === 1) return true;
		if (cls === PROBE_SCHEME) {
			if (raw.charCodeAt(i + 1) === 0x2f && raw.charCodeAt(i + 2) === 0x2f) return true; // ://
			if (probePlugins && isScanProbeTrigger(raw[i])) return true; // registered ':'
		} else {
			if (
				(raw.charCodeAt(i + 1) | 0x20) === 0x77 &&
				(raw.charCodeAt(i + 2) | 0x20) === 0x77 &&
				raw.charCodeAt(i + 3) === 0x2e
			) {
				return true; // www.
			}
			if (probePlugins && isScanProbeTrigger(raw[i])) return true; // registered 'w'/'W'
		}
	}
	return false;
}

// Try a trigger's rungs in dispatch order: the first whose prefix matches at
// `ctx.pos` and whose recognizer claims wins. The claim validation (a node must
// start at the cursor and advance) lives here once — both the pre-switch
// consultation and the `default` arm route through it. A decline leaves `ctx`
// untouched, so a fall-through to a built-in case reads byte-identical bytes.
function tryRungs(ctx: ScanContext, rungs: InlineRung[] | undefined): InlineNode | null {
	if (!rungs) return null;
	const { raw, pos, end } = ctx;
	for (const rung of rungs) {
		if (!raw.startsWith(rung.prefix, pos)) continue;
		const node = rung.recognizer(raw, pos, end);
		if (!node) continue;
		if (node.start !== pos) {
			throw new Error(`inline-syntax "${rung.prefix}" started at ${node.start}, expected ${pos}`);
		}
		if (node.end <= pos) {
			throw new Error(`inline-syntax "${rung.prefix}" did not advance`);
		}
		return node;
	}
	return null;
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
	// Reserved-trigger prefix rungs are consulted before the switch so they can
	// outrank a built-in case — the only order that can work, because a handler
	// consumes its trigger and advances (`handleBang` eats `![` as one unit), so the
	// scan never returns to a position the switch has already read. Hoisted so an
	// empty registry adds no per-char cost.
	const consultPrefixRungs = hasPrefixRungs();
	while (ctx.pos < ctx.end) {
		if (consultPrefixRungs) {
			const node = tryRungs(ctx, getPrefixRungs(raw[ctx.pos]));
			if (node) {
				appendNode(ctx, node);
				continue;
			}
		}
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
					const node = tryRungs(ctx, getUnreservedRungs(raw[ctx.pos]));
					if (node) {
						appendNode(ctx, node);
						break;
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

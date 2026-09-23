/**
 * Single-pass inline scanner (the CommonMark reference architecture), exported as `parseInline`
 * from ../index.ts. Contract: InlineNode[] with absolute offsets into raw, covering [start, end).
 */

import { isBuiltinInlineKind, type InlineNode, type InlineSyntaxClaim } from '../../nodes';
import type { LinkReferenceResolver } from '../link-reference-resolver';
import { defaultGrammarView, ownerEnabled, type GrammarView } from '../../../schema/block-openers';
import { inlineDescendants } from '../walk';
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

// Every character that can start a construct or anchor a lookback: the dispatch cases below
// plus `@` (GFM email lookback). `!` and `]` are deliberately absent, mattering only in ranges
// that also contain `[`; a plugin registration makes `!` visible (plugin-syntax.ts).
const SPECIAL_CHARS = '\\`&\n<[*_~@';

// GFM bare http/www autolinks contain no character from the set above, so their starts get
// conditional probes: `:` counts only when `//` follows, `w`/`W` only on a `www.` prefix. The
// lookahead may read past `end` and over-trigger, which costs one wasted scan, never a node.
const PROBE_SCHEME = 2;
const PROBE_WWW = 3;

const SPECIAL = new Uint8Array(128);
for (let i = 0; i < SPECIAL_CHARS.length; i++) SPECIAL[SPECIAL_CHARS.charCodeAt(i)] = 1;
SPECIAL[0x3a] = PROBE_SCHEME; // :
SPECIAL[0x57] = PROBE_WWW; // W
SPECIAL[0x77] = PROBE_WWW; // w

/** Fast bail for the per-keystroke hot path: plain prose skips the scan loop. */
function needsScan(raw: string, start: number, end: number): boolean {
	// Registered plugin triggers are held out of SPECIAL_CHARS, so probe them only when
	// something is registered; an unregistered scan pays one always-false test per character.
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

// Tries a trigger's plugin handlers in dispatch order: the first whose prefix matches at `ctx.pos`,
// whose plugin this editor lists, and whose recognizer claims wins. The claim checks live here
// once, for both dispatch paths, after the decline so a declining handler leaves `ctx` untouched.
function tryRungs(
	ctx: ScanContext,
	rungs: InlineRung[] | undefined,
	grammar: GrammarView
): InlineNode | null {
	if (!rungs) return null;
	const { raw, pos, end } = ctx;
	for (const rung of rungs) {
		if (!raw.startsWith(rung.prefix, pos) || !ownerEnabled(grammar, rung.owner)) continue;
		const node = rung.recognizer(raw, pos, end, grammar);
		if (!node) continue;
		if (node.start !== pos) {
			throw new Error(`inline-syntax "${rung.prefix}" started at ${node.start}, expected ${pos}`);
		}
		if (node.end <= pos) {
			throw new Error(`inline-syntax "${rung.prefix}" did not advance`);
		}
		// A block's scan range is not always its whole raw (a heading's excludes the closing `#`
		// run, a table cell's the `|`), so a recognizer searching the whole string claims bytes the
		// block still needs, and the only trace is wrong caret offsets. Ending exactly at `end` is
		// fine; only past it is a fault.
		if (node.end > end) {
			throw new Error(
				`inline-syntax "${rung.prefix}" claimed [${node.start}, ${node.end}), past the scan ` +
					`range end ${end}: a recognizer must bound its search by the \`end\` it is given`
			);
		}
		stampClaim(node, rung);
		return node;
	}
	return null;
}

// A plugin handler that creates a built-in kind (an `image` over `![[cat.png]]`) borrows the
// editor's model for its own bytes, and the editor's writers emit built-in grammar, so a resize
// would rewrite the author's syntax as GFM; the claim tells the writers whose syntax it is.
// Descendants are marked by the same rule; a plugin's own kind needs no mark. Assigned, never
// merged, so a recognizer cannot name its own claimer.
function stampClaim(node: InlineNode, claim: InlineSyntaxClaim): void {
	for (const inline of inlineDescendants([node])) {
		if (isBuiltinInlineKind(inline.kind)) inline.syntaxClaim = claim;
	}
}

/** `grammar` is the editor's: a handler whose plugin it leaves out never runs, so its bytes stay text. */
export function scanInline(
	raw: string,
	start: number,
	end: number,
	resolver?: LinkReferenceResolver,
	grammar: GrammarView = defaultGrammarView
): InlineNode[] {
	if (start >= end) return [];
	if (!needsScan(raw, start, end)) {
		return [{ kind: 'text', start, end, text: raw.slice(start, end) }];
	}

	const ctx = createScanContext(raw, start, end, resolver);
	// Reserved-trigger prefix handlers are consulted before the switch so they can outrank a
	// built-in one: a built-in handler consumes its trigger and advances (`handleBang` eats `![`
	// whole), so the scan never returns to a position the switch has read. The check is hoisted
	// so an empty registry costs nothing.
	const consultPrefixRungs = hasPrefixRungs();
	while (ctx.pos < ctx.end) {
		if (consultPrefixRungs) {
			const node = tryRungs(ctx, getPrefixRungs(raw[ctx.pos]), grammar);
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
					const node = tryRungs(ctx, getUnreservedRungs(raw[ctx.pos]), grammar);
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

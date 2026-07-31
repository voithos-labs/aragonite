/**
 * Bracket stack for inline and reference links/images (CommonMark §6.3), ported onto the flat
 * working-node list. A failed `]` leaves its brackets literal, except full/collapsed references
 * that miss the resolver: those commit to one opaque `unresolvedReference` node (editor deviation).
 * `url`/`title` are spec-processed for inline forms and byte-exact from the resolver for reference
 * forms; neither is ever serialized, so offsets stay lossless.
 */

import type { InlineNode } from '../../nodes';
import { ESCAPABLE_PUNCTUATION } from '../../escapable';
import { parseImageDimensions } from '../image-dimensions';
import { normalizeLinkLabel, type ResolvedReference } from '../link-reference-resolver';
import { processEmphasis } from './emphasis';
import {
	appendNode,
	flushPendingText,
	mergeAdjacentText,
	type Bracket,
	type ScanContext
} from './scan-state';
import { processDestination, unescapeSpecString } from './url';

// ── Scan-time handlers ──────────────────────────────────────────────────────

export function handleOpenBracket(ctx: ScanContext): void {
	pushBracket(ctx, false);
}

export function handleBang(ctx: ScanContext): void {
	if (ctx.pos + 1 < ctx.end && ctx.raw[ctx.pos + 1] === '[') pushBracket(ctx, true);
	else ctx.pos++;
}

function pushBracket(ctx: ScanContext, isImage: boolean): void {
	const start = ctx.pos;
	const end = start + (isImage ? 2 : 1);
	appendNode(ctx, { kind: 'text', start, end, text: ctx.raw.slice(start, end) });
	const enclosing = ctx.brackets[ctx.brackets.length - 1];
	if (enclosing !== undefined) enclosing.bracketAfter = true;
	ctx.brackets.push({
		nodeIndex: ctx.nodes.length - 1,
		isImage,
		active: true,
		bracketAfter: false,
		delimiterFloor: ctx.delimiters.length
	});
}

export function handleCloseBracket(ctx: ScanContext): void {
	const bracket = ctx.brackets[ctx.brackets.length - 1];
	if (bracket === undefined) {
		ctx.pos++;
		return;
	}
	if (!bracket.active) {
		ctx.brackets.pop();
		ctx.pos++;
		return;
	}

	const labelEnd = ctx.pos;
	const inline = parseInlineLinkTail(ctx.raw, labelEnd + 1, ctx.end);
	if (inline !== null) {
		wrapMatchedBracket(ctx, bracket, labelEnd, inline);
		return;
	}

	const ref = parseReferenceTail(ctx, bracket, labelEnd);
	if (ref === null) {
		ctx.brackets.pop();
		ctx.pos++;
		return;
	}
	if (ref.resolved === undefined) {
		emitUnresolvedReference(ctx, bracket, ref);
		return;
	}
	wrapMatchedBracket(ctx, bracket, labelEnd, {
		url: ref.resolved.url,
		...(ref.resolved.title !== undefined ? { title: ref.resolved.title } : {}),
		label: ref.label,
		end: ref.end
	});
}

function wrapMatchedBracket(
	ctx: ScanContext,
	bracket: Bracket,
	labelEnd: number,
	target: LinkTarget
): void {
	ctx.brackets.pop();
	flushPendingText(ctx, labelEnd);
	processEmphasis(ctx, bracket.delimiterFloor);

	const opener = ctx.nodes[bracket.nodeIndex];
	const children = mergeAdjacentText(ctx.nodes.splice(bracket.nodeIndex + 1));
	ctx.nodes[bracket.nodeIndex] = bracket.isImage
		? buildImage(ctx.raw, opener, labelEnd, target, children)
		: buildLink(opener, target, children);
	ctx.pos = target.end;
	ctx.textStart = target.end;

	// §6.3 no links inside links: a matched link deactivates enclosing link openers, not images.
	if (!bracket.isImage) {
		for (const open of ctx.brackets) {
			if (!open.isImage) open.active = false;
		}
	}
}

function buildLink(opener: InlineNode, target: LinkTarget, children: InlineNode[]): InlineNode {
	return {
		kind: 'link',
		start: opener.start,
		end: target.end,
		children,
		url: target.url,
		...(target.title !== undefined ? { title: target.title } : {}),
		...(target.label !== undefined ? { label: target.label } : {})
	};
}

function buildImage(
	raw: string,
	opener: InlineNode,
	labelEnd: number,
	target: LinkTarget,
	children: InlineNode[]
): InlineNode {
	const dims = parseImageDimensions(raw.slice(opener.end, labelEnd));
	return {
		kind: 'image',
		start: opener.start,
		end: target.end,
		children,
		alt: dims.displayAlt,
		url: target.url,
		...(target.title !== undefined ? { title: target.title } : {}),
		...(dims.width !== undefined ? { width: dims.width } : {}),
		...(dims.height !== undefined ? { height: dims.height } : {}),
		...(target.label !== undefined ? { label: target.label } : {})
	};
}

interface LinkTarget {
	url: string;
	title?: string;
	/** Normalized label, reference forms only. */
	label?: string;
	/** Offset just past the closing `)` or the reference's final `]`. */
	end: number;
}

// ── Reference tail: [label], [], or nothing after the text (§6.3) ───────────

interface ReferenceTail {
	label: string;
	/** Offset just past the form's final `]`; the text's `]` + 1 for shortcut. */
	end: number;
	/** Undefined is a lookup miss: full/collapsed forms commit to unresolvedReference. */
	resolved: ResolvedReference | undefined;
}

function parseReferenceTail(
	ctx: ScanContext,
	bracket: Bracket,
	labelEnd: number
): ReferenceTail | null {
	const { raw, end, resolver } = ctx;
	if (resolver === undefined) return null;

	const afterText = labelEnd + 1;
	const secondEnd = parseLinkLabel(raw, afterText, end);
	if (secondEnd !== null && secondEnd > afterText + 2) {
		const rawLabel = raw.slice(afterText + 1, secondEnd - 1);
		return { label: normalizeLinkLabel(rawLabel), end: secondEnd, resolved: resolver(rawLabel) };
	}

	// Collapsed/shortcut reuse the link text as label, and a bracket opened inside it can never
	// be part of a valid label, so skip the lookup outright (the reference's bracketAfter guard).
	if (bracket.bracketAfter) return null;
	const rawLabel = raw.slice(ctx.nodes[bracket.nodeIndex].end, labelEnd);
	if (secondEnd !== null) {
		return { label: normalizeLinkLabel(rawLabel), end: secondEnd, resolved: resolver(rawLabel) };
	}
	const resolved = resolver(rawLabel);
	if (resolved === undefined) return null; // shortcut never commits on a miss
	return { label: normalizeLinkLabel(rawLabel), end: afterText, resolved };
}

/** CommonMark §6.3 label: at most 999 content chars, no unescaped brackets. */
function parseLinkLabel(raw: string, pos: number, end: number): number | null {
	if (pos >= end || raw[pos] !== '[') return null;
	let i = pos + 1;
	while (i < end && i - pos <= 1000) {
		const ch = raw[i];
		if (ch === ']') return i + 1;
		if (ch === '[') return null;
		i += ch === '\\' ? 2 : 1;
	}
	return null;
}

function emitUnresolvedReference(ctx: ScanContext, bracket: Bracket, ref: ReferenceTail): void {
	ctx.brackets.pop();
	ctx.delimiters.length = bracket.delimiterFloor;
	const start = ctx.nodes[bracket.nodeIndex].start;
	ctx.nodes.length = bracket.nodeIndex;
	ctx.nodes.push({
		kind: 'unresolvedReference',
		start,
		end: ref.end,
		label: ref.label,
		refKind: bracket.isImage ? 'image' : 'link'
	});
	ctx.pos = ref.end;
	ctx.textStart = ref.end;
}

// ── Inline-link tail: "(" destination title? ")" ────────────────────────────

function parseInlineLinkTail(raw: string, pos: number, end: number): LinkTarget | null {
	if (pos >= end || raw[pos] !== '(') return null;
	let i = skipSpnl(raw, pos + 1, end);
	const dest = parseDestination(raw, i, end);
	if (dest === null) return null;
	i = skipSpnl(raw, dest.end, end);

	// A title needs real whitespace after the destination; a quote abutting it is destination content.
	let title: string | undefined;
	if (i > dest.end) {
		const parsed = parseTitle(raw, i, end);
		if (parsed !== null) {
			title = parsed.title;
			i = skipSpnl(raw, parsed.end, end);
		}
	}
	if (i >= end || raw[i] !== ')') return null;
	return { url: dest.url, ...(title !== undefined ? { title } : {}), end: i + 1 };
}

/** The reference's spnl: spaces, at most one newline, spaces — tabs excluded. */
function skipSpnl(raw: string, pos: number, end: number): number {
	while (pos < end && raw[pos] === ' ') pos++;
	if (pos < end && raw[pos] === '\n') {
		pos++;
		while (pos < end && raw[pos] === ' ') pos++;
	}
	return pos;
}

function parseDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
	if (pos < end && raw[pos] === '<') return parseAngleDestination(raw, pos, end);
	return parseBareDestination(raw, pos, end);
}

function parseAngleDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
	let i = pos + 1;
	while (i < end) {
		const ch = raw[i];
		if (ch === '>') return { url: processDestination(raw.slice(pos + 1, i)), end: i + 1 };
		if (ch === '<' || ch === '\n' || ch === '\u0000') return null;
		if (ch === '\\') {
			const next = i + 1 < end ? raw[i + 1] : '';
			if (next === '' || next === '\n' || next === '\r' || next === '\u2028' || next === '\u2029') {
				return null;
			}
			i += 2;
		} else {
			i++;
		}
	}
	return null;
}

// The reference's destination terminator set (reWhitespaceChar): other control characters,
// and U+00A0, are destination content.
const DESTINATION_TERMINATORS = new Set(' \t\n\u000b\u000c\r');

/** Bare form: balanced parens, no depth cap. Empty is valid only just before the closing `)`. */
function parseBareDestination(
	raw: string,
	pos: number,
	end: number
): { url: string; end: number } | null {
	let i = pos;
	let openParens = 0;
	while (i < end) {
		const ch = raw[i];
		if (ch === '\\' && i + 1 < end && ESCAPABLE_PUNCTUATION.has(raw[i + 1])) {
			i += 2;
		} else if (ch === '(') {
			openParens++;
			i++;
		} else if (ch === ')') {
			if (openParens < 1) break;
			openParens--;
			i++;
		} else if (DESTINATION_TERMINATORS.has(ch)) {
			break;
		} else {
			i++;
		}
	}
	if (i === pos && (i >= end || raw[i] !== ')')) return null;
	if (openParens !== 0) return null;
	return { url: processDestination(raw.slice(pos, i)), end: i };
}

/** Paren titles cannot nest. */
function parseTitle(raw: string, pos: number, end: number): { title: string; end: number } | null {
	const marker = raw[pos];
	if (marker !== '"' && marker !== "'" && marker !== '(') return null;
	const close = marker === '(' ? ')' : marker;
	let i = pos + 1;
	while (i < end) {
		const ch = raw[i];
		if (ch === close) return { title: unescapeSpecString(raw.slice(pos + 1, i)), end: i + 1 };
		if (ch === '\u0000' || (marker === '(' && ch === '(')) return null;
		if (ch === '\\' && i + 1 < end) i += 2;
		else i++;
	}
	return null;
}

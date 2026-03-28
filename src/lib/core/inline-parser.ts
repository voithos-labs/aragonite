/**
 * Inline parser for prose block content (CST Phase 2).
 * Produces InlineNode trees from the content portion of raw text.
 * See docs/editor/inline-parsing-design.md for the design spec.
 *
 * Parsing stages:
 *   Stage 1  — backtick code spans (scanBacktickSpans)
 *   Stage 1.5 — links, images, autolinks (scanLinksAndAutolinks)
 *   Stage 2  — delimiter runs / emphasis (buildSegments + processEmphasis)
 *   Post     — hard line breaks, merge adjacent text
 */

import type { CstNode, InlineNode } from './nodes';

// ── Content Range ──────────────────────────────────────────────────────────

export interface ContentRange {
	start: number;
	end: number;
}

/**
 * Extract the content range within a prose block's raw text.
 * Returns start/end offsets that exclude block-level markers and trailing line endings.
 */
export function getContentRange(node: CstNode): ContentRange {
	const raw = node.raw;

	if (node.kind === 'heading') {
		let i = 0;
		while (i < raw.length && raw[i] === ' ') i++;
		while (i < raw.length && raw[i] === '#') i++;
		if (i < raw.length && raw[i] === ' ') i++;
		return { start: i, end: trimTrailingLineEnding(raw) };
	}

	if (node.kind === 'setextHeading') {
		const end = trimTrailingLineEnding(raw);
		let underlineStart = raw.lastIndexOf('\n', end - 1);
		if (underlineStart === -1) return { start: 0, end };
		let contentEnd = underlineStart;
		if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
		return { start: 0, end: contentEnd };
	}

	// paragraph and other prose blocks
	return { start: 0, end: trimTrailingLineEnding(raw) };
}

function trimTrailingLineEnding(raw: string): number {
	let end = raw.length;
	if (raw.endsWith('\r\n')) end -= 2;
	else if (raw.endsWith('\n')) end -= 1;
	return end;
}

/** Returns true if the given block kind carries inline content (paragraph, heading, setextHeading). */
export function isProseKind(kind: string): boolean {
	return kind === 'paragraph' || kind === 'heading' || kind === 'setextHeading';
}

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content within a prose block's raw text.
 * Returns an InlineNode[] tree covering the range [start, end) in raw.
 * All start/end offsets in returned nodes are relative to the full raw string.
 */
export function parseInline(raw: string, start: number, end: number): InlineNode[] {
	// Stage 1: backtick code spans
	const codeSpans = scanBacktickSpans(raw, start, end);

	// Stage 1.5: links, images, autolinks — these become occupied ranges for Stage 2
	const withLinks = scanLinksAndAutolinks(raw, start, end, codeSpans);

	// Check if there are any delimiter characters in the unoccupied text regions
	if (!hasDelimiterChars(raw, start, end, withLinks)) {
		return processHardLineBreaks(withLinks, raw);
	}

	const segments = buildSegments(raw, start, end, withLinks);
	const emphasized = processEmphasis(raw, segments);
	const merged = mergeAdjacentText(emphasized);
	return processHardLineBreaks(merged, raw);
}

// ── Backtick Scanning (Stage 1) ────────────────────────────────────────────

/**
 * Returns resolved InlineNodes (text + inlineCode) for the range.
 * Used as input to the emphasis stage; code spans mark occupied ranges.
 */
function scanBacktickSpans(raw: string, start: number, end: number): InlineNode[] {
	const nodes: InlineNode[] = [];
	let pos = start;
	let textStart = start;

	while (pos < end) {
		if (raw[pos] === '`') {
			const tickStart = pos;
			while (pos < end && raw[pos] === '`') pos++;
			const tickLen = pos - tickStart;

			// Search for matching closing backtick sequence
			let closeStart = -1;
			let searchPos = pos;
			while (searchPos < end) {
				if (raw[searchPos] === '`') {
					const cStart = searchPos;
					while (searchPos < end && raw[searchPos] === '`') searchPos++;
					if (searchPos - cStart === tickLen) {
						closeStart = cStart;
						break;
					}
				} else {
					searchPos++;
				}
			}

			if (closeStart !== -1) {
				if (textStart < tickStart) {
					nodes.push({
						kind: 'text',
						start: textStart,
						end: tickStart,
						text: raw.slice(textStart, tickStart)
					});
				}

				const contentStart = tickStart + tickLen;
				const contentEnd = closeStart;
				nodes.push({
					kind: 'inlineCode',
					start: tickStart,
					end: closeStart + tickLen,
					text: raw.slice(contentStart, contentEnd)
				});

				textStart = closeStart + tickLen;
				pos = textStart;
			}
		} else {
			pos++;
		}
	}

	if (textStart < end) {
		nodes.push({
			kind: 'text',
			start: textStart,
			end: end,
			text: raw.slice(textStart, end)
		});
	}

	return nodes;
}

// ── Links, Images, Autolinks (Stage 1.5) ──────────────────────────────────

/**
 * Attempt to parse a link/image destination `(url "title")` starting at pos.
 * pos must point at the `(` character.
 * Returns { url, title, end } on success (end is past the closing `)`), or null.
 */
function parseDestination(
	raw: string,
	pos: number,
	limit: number
): { url: string; title: string | undefined; end: number } | null {
	if (pos >= limit || raw[pos] !== '(') return null;
	pos++; // consume '('

	// Skip optional leading whitespace
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	// Read URL — stop at whitespace, '"', "'", ')', or '<'
	const urlStart = pos;
	while (pos < limit && raw[pos] !== ')' && raw[pos] !== ' ' && raw[pos] !== '\t' && raw[pos] !== '"' && raw[pos] !== "'") {
		pos++;
	}
	const url = raw.slice(urlStart, pos);

	// Skip whitespace between url and optional title
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	// Optional title: "..." or '...'
	let title: string | undefined;
	if (pos < limit && (raw[pos] === '"' || raw[pos] === "'")) {
		const quote = raw[pos];
		pos++; // consume opening quote
		const titleStart = pos;
		while (pos < limit && raw[pos] !== quote) pos++;
		if (pos >= limit) return null; // unterminated title
		title = raw.slice(titleStart, pos);
		pos++; // consume closing quote
	}

	// Skip trailing whitespace
	while (pos < limit && (raw[pos] === ' ' || raw[pos] === '\t')) pos++;

	if (pos >= limit || raw[pos] !== ')') return null;
	pos++; // consume ')'

	return { url, title, end: pos };
}

/**
 * Scan text regions (not occupied by code spans) for links, images, and autolinks.
 * Returns an updated node list where link/image/autolink nodes are spliced in
 * and the surrounding text nodes are trimmed accordingly.
 *
 * Occupied ranges (code spans + found links/images/autolinks) are used to ensure
 * Stage 2 treats their ranges as non-text.
 */
function scanLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	codeSpans: InlineNode[]
): InlineNode[] {
	// Build list of occupied ranges from code spans
	const occupied: Array<{ s: number; e: number }> = codeSpans
		.filter(n => n.kind === 'inlineCode')
		.map(n => ({ s: n.start, e: n.end }));

	// Collect all link/image/autolink nodes found in unoccupied text
	const found: InlineNode[] = [];

	// Walk through text regions between code spans
	let pos = start;
	for (const occ of occupied) {
		scanRegionForLinksAndAutolinks(raw, pos, occ.s, found);
		pos = occ.e;
	}
	scanRegionForLinksAndAutolinks(raw, pos, end, found);

	if (found.length === 0) return codeSpans;

	// Merge code spans and found nodes, sorted by start position
	const allOccupied: InlineNode[] = [...codeSpans.filter(n => n.kind === 'inlineCode'), ...found]
		.sort((a, b) => a.start - b.start);

	// Rebuild the node list: text gaps + occupied nodes
	const result: InlineNode[] = [];
	let cursor = start;

	for (const node of allOccupied) {
		if (cursor < node.start) {
			result.push({
				kind: 'text',
				start: cursor,
				end: node.start,
				text: raw.slice(cursor, node.start)
			});
		}
		result.push(node);
		cursor = node.end;
	}
	if (cursor < end) {
		result.push({
			kind: 'text',
			start: cursor,
			end,
			text: raw.slice(cursor, end)
		});
	}

	return result;
}

/**
 * Scan a single unoccupied text region for link, image, and autolink patterns.
 * Appends any found nodes to `out`.
 */
function scanRegionForLinksAndAutolinks(
	raw: string,
	start: number,
	end: number,
	out: InlineNode[]
): void {
	let pos = start;

	while (pos < end) {
		const ch = raw[pos];

		// Check for image: ![
		if (ch === '!' && pos + 1 < end && raw[pos + 1] === '[') {
			const bracketOpen = pos + 1;
			const bracketClose = findMatchingBracket(raw, bracketOpen, end);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					const alt = raw.slice(bracketOpen + 1, bracketClose);
					out.push({
						kind: 'image',
						start: pos,
						end: dest.end,
						alt,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {})
					});
					pos = dest.end;
					continue;
				}
			}
			pos++;
			continue;
		}

		// Check for link: [
		if (ch === '[') {
			const bracketClose = findMatchingBracket(raw, pos, end);
			if (bracketClose !== -1) {
				const dest = parseDestination(raw, bracketClose + 1, end);
				if (dest !== null) {
					// Recursively parse the link text for emphasis etc.
					const children = parseInline(raw, pos + 1, bracketClose);
					out.push({
						kind: 'link',
						start: pos,
						end: dest.end,
						children,
						url: dest.url,
						...(dest.title !== undefined ? { title: dest.title } : {})
					});
					pos = dest.end;
					continue;
				}
			}
			pos++;
			continue;
		}

		// Check for angle-bracket autolink: <https://...> or <http://...>
		if (ch === '<') {
			const closeAngle = raw.indexOf('>', pos + 1);
			if (closeAngle !== -1 && closeAngle < end) {
				const inner = raw.slice(pos + 1, closeAngle);
				if (/^https?:\/\/\S+$/.test(inner)) {
					out.push({
						kind: 'autolink',
						start: pos,
						end: closeAngle + 1,
						url: inner
					});
					pos = closeAngle + 1;
					continue;
				}
			}
			pos++;
			continue;
		}

		// Check for bare URL autolink: https:// or http://
		if (ch === 'h' || ch === 'H') {
			const lower = raw.slice(pos, pos + 8).toLowerCase();
			const schemeLen = lower.startsWith('https://') ? 8 : lower.startsWith('http://') ? 7 : 0;
			if (schemeLen > 0) {
				let urlEnd = pos + schemeLen;
				while (urlEnd < end && !/\s/.test(raw[urlEnd])) urlEnd++;
				if (urlEnd > pos + schemeLen) {
					const url = raw.slice(pos, urlEnd);
					out.push({
						kind: 'autolink',
						start: pos,
						end: urlEnd,
						url
					});
					pos = urlEnd;
					continue;
				}
			}
		}

		pos++;
	}
}

/**
 * Find the matching `]` for the `[` at bracketStart.
 * bracketStart points at `[`. Handles nested brackets.
 * Returns the index of `]`, or -1 if not found within limit.
 */
function findMatchingBracket(raw: string, bracketStart: number, limit: number): number {
	let depth = 0;
	let pos = bracketStart;
	while (pos < limit) {
		if (raw[pos] === '[') depth++;
		else if (raw[pos] === ']') {
			depth--;
			if (depth === 0) return pos;
		}
		pos++;
	}
	return -1;
}

// ── Delimiter Run Scanning (Stage 2) ───────────────────────────────────────

/** A delimiter run: a sequence of *, _, or ~ characters. */
interface DelimiterEntry {
	kind: '*' | '_' | '~';
	/** Number of delimiter characters remaining (decremented as matched). */
	count: number;
	/** Original length of this run. */
	origCount: number;
	/** Start offset in raw (absolute). */
	start: number;
	/** End offset in raw (absolute, exclusive). */
	end: number;
	canOpen: boolean;
	canClose: boolean;
}

/**
 * A segment is either a resolved inline node (text or code span produced by
 * stage 1) or a delimiter entry that still needs matching.
 */
type Segment =
	| { type: 'node'; node: InlineNode }
	| { type: 'delimiter'; entry: DelimiterEntry };

/** Returns true if any text region between occupied nodes contains *, _, or ~. */
function hasDelimiterChars(
	raw: string,
	start: number,
	end: number,
	nodes: InlineNode[]
): boolean {
	// Build occupied ranges from all non-text nodes
	const occupied: Array<{ s: number; e: number }> = nodes
		.filter(n => n.kind !== 'text')
		.map(n => ({ s: n.start, e: n.end }));

	let pos = start;
	for (const { s, e } of occupied) {
		for (let i = pos; i < s; i++) {
			if (raw[i] === '*' || raw[i] === '_' || raw[i] === '~') return true;
		}
		pos = e;
	}
	for (let i = pos; i < end; i++) {
		if (raw[i] === '*' || raw[i] === '_' || raw[i] === '~') return true;
	}
	return false;
}

/** Unicode punctuation detection (covers ASCII punctuation + general category P). */
function isPunct(ch: string): boolean {
	if (!ch) return false;
	// ASCII punctuation
	const code = ch.codePointAt(0)!;
	if (
		(code >= 0x21 && code <= 0x2f) || // !"#$%&'()*+,-./
		(code >= 0x3a && code <= 0x40) || // :;<=>?@
		(code >= 0x5b && code <= 0x60) || // [\]^_`
		(code >= 0x7b && code <= 0x7e) // {|}~
	) {
		return true;
	}
	// Use Unicode category via regex for non-ASCII
	return /^\p{P}$/u.test(ch);
}

function isWhitespace(ch: string): boolean {
	if (!ch) return true; // treat boundary as whitespace (start/end of string)
	return /\s/.test(ch);
}

/**
 * Classify a delimiter run for canOpen / canClose.
 * runStart/runEnd are absolute offsets into raw.
 */
function classifyRun(
	raw: string,
	runStart: number,
	runEnd: number,
	kind: '*' | '_' | '~'
): { canOpen: boolean; canClose: boolean } {
	const charBefore = runStart > 0 ? raw[runStart - 1] : '';
	const charAfter = runEnd < raw.length ? raw[runEnd] : '';

	const followedByWhitespace = isWhitespace(charAfter);
	const followedByPunct = isPunct(charAfter);
	const precededByWhitespace = isWhitespace(charBefore);
	const precededByPunct = isPunct(charBefore);

	// Left-flanking: not followed by whitespace, and (not followed by punctuation
	// OR preceded by whitespace or punctuation)
	const leftFlanking =
		!followedByWhitespace && (!followedByPunct || precededByWhitespace || precededByPunct);

	// Right-flanking: not preceded by whitespace, and (not preceded by punctuation
	// OR followed by whitespace or punctuation)
	const rightFlanking =
		!precededByWhitespace && (!precededByPunct || followedByWhitespace || followedByPunct);

	if (kind === '*' || kind === '~') {
		// * and ~ use pure left/right flanking rules
		return { canOpen: leftFlanking, canClose: rightFlanking };
	} else {
		// _: extra restrictions to avoid intra-word emphasis
		const canOpen = leftFlanking && (!rightFlanking || precededByPunct);
		const canClose = rightFlanking && (!leftFlanking || followedByPunct);
		return { canOpen, canClose };
	}
}

/**
 * Build a flat list of segments from the content range.
 * Occupied nodes (inlineCode, link, image, autolink from stages 1/1.5) are
 * inserted as 'node' segments; text regions between them are scanned for
 * delimiter runs.
 */
function buildSegments(
	raw: string,
	start: number,
	end: number,
	stageNodes: InlineNode[]
): Segment[] {
	const segments: Segment[] = [];

	let pos = start;

	for (const node of stageNodes) {
		if (node.kind !== 'text') {
			// Scan the text region before this occupied node for delimiters
			if (pos < node.start) {
				scanTextRegionForDelimiters(raw, pos, node.start, segments);
			}
			segments.push({ type: 'node', node });
			pos = node.end;
		}
		// 'text' nodes will be reconstructed from delimiter scanning; skip them.
	}

	// Remaining text after the last occupied node
	if (pos < end) {
		scanTextRegionForDelimiters(raw, pos, end, segments);
	}

	return segments;
}

/**
 * Scan a text region and emit text segments and delimiter segments.
 */
function scanTextRegionForDelimiters(
	raw: string,
	start: number,
	end: number,
	out: Segment[]
): void {
	let pos = start;
	let textStart = start;

	while (pos < end) {
		const ch = raw[pos];
		if (ch === '*' || ch === '_' || ch === '~') {
			const runStart = pos;
			while (pos < end && raw[pos] === ch) pos++;
			const runEnd = pos;
			const count = runEnd - runStart;

			// ~ is only valid as a strikethrough delimiter in runs of exactly 2
			if (ch === '~' && count !== 2) {
				// Emit the whole ~ run as plain text
				if (textStart < runStart) {
					out.push({
						type: 'node',
						node: {
							kind: 'text',
							start: textStart,
							end: runStart,
							text: raw.slice(textStart, runStart)
						}
					});
				}
				out.push({
					type: 'node',
					node: {
						kind: 'text',
						start: runStart,
						end: runEnd,
						text: raw.slice(runStart, runEnd)
					}
				});
				textStart = runEnd;
				continue;
			}

			const { canOpen, canClose } = classifyRun(raw, runStart, runEnd, ch as '*' | '_' | '~');

			// Emit preceding text as a text segment
			if (textStart < runStart) {
				out.push({
					type: 'node',
					node: {
						kind: 'text',
						start: textStart,
						end: runStart,
						text: raw.slice(textStart, runStart)
					}
				});
			}

			out.push({
				type: 'delimiter',
				entry: {
					kind: ch as '*' | '_' | '~',
					count,
					origCount: count,
					start: runStart,
					end: runEnd,
					canOpen,
					canClose
				}
			});

			textStart = runEnd;
		} else {
			pos++;
		}
	}

	if (textStart < end) {
		out.push({
			type: 'node',
			node: {
				kind: 'text',
				start: textStart,
				end: end,
				text: raw.slice(textStart, end)
			}
		});
	}
}

// ── Emphasis Matching (CommonMark algorithm) ───────────────────────────────

/**
 * Process the delimiter stack using the CommonMark emphasis matching algorithm.
 * Returns a flat InlineNode[] (emphasis/strong nodes may have children).
 */
function processEmphasis(raw: string, segments: Segment[]): InlineNode[] {
	// We'll work with a mutable array of items. Each item is either a node
	// or a delimiter entry. We repeatedly scan for a closer, find its opener,
	// wrap the content between them, and restart.

	// Clone segments into a working list
	type Item =
		| { type: 'node'; node: InlineNode }
		| { type: 'delimiter'; entry: DelimiterEntry };

	const items: Item[] = segments.map(s =>
		s.type === 'node' ? { type: 'node', node: s.node } : { type: 'delimiter', entry: { ...s.entry } }
	);

	let changed = true;
	while (changed) {
		changed = false;

		// Find the leftmost closer
		for (let ci = 0; ci < items.length; ci++) {
			const closerItem = items[ci];
			if (closerItem.type !== 'delimiter') continue;
			const closer = closerItem.entry;
			if (!closer.canClose || closer.count === 0) continue;

			// Find the nearest opener to the left
			let openerIdx = -1;
			for (let oi = ci - 1; oi >= 0; oi--) {
				const openerItem = items[oi];
				if (openerItem.type !== 'delimiter') continue;
				const opener = openerItem.entry;
				if (!opener.canOpen || opener.count === 0) continue;
				if (opener.kind !== closer.kind) continue;

				// Multiple-of-3 rule
				if (
					(opener.canClose || closer.canOpen) &&
					(opener.count + closer.count) % 3 === 0 &&
					!(opener.count % 3 === 0 && closer.count % 3 === 0)
				) {
					continue;
				}

				openerIdx = oi;
				break;
			}

			if (openerIdx === -1) continue;

			const openerItem = items[openerIdx] as { type: 'delimiter'; entry: DelimiterEntry };
			const opener = openerItem.entry;

			// Determine consume count and kind
			let consume: number;
			let nodeKind: InlineNode['kind'];
			if (opener.kind === '~') {
				// ~ delimiters are always exactly 2 (enforced during scanning)
				consume = 2;
				nodeKind = 'strikethrough';
			} else {
				consume = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
				nodeKind = consume === 2 ? 'strong' : 'emphasis';
			}

			// The opener marker occupies the last `consume` chars of its run
			const openerMarkerStart = opener.end - consume;
			const openerMarkerEnd = opener.end;

			// The closer marker occupies the first `consume` chars of its run
			const closerMarkerStart = closer.start;
			const closerMarkerEnd = closer.start + consume;

			// Collect child nodes/delimiters between opener and closer
			const childItems = items.slice(openerIdx + 1, ci);
			const children = resolveItems(raw, childItems);

			const wrappedNode: InlineNode = {
				kind: nodeKind,
				start: openerMarkerStart,
				end: closerMarkerEnd,
				children
			};

			// Reduce or remove opener
			opener.count -= consume;
			opener.end -= consume;
			// Reduce or remove closer
			closer.count -= consume;
			closer.start += consume;

			// Replace [openerIdx+1 .. ci] with the wrapped node
			const newItem: Item = { type: 'node', node: wrappedNode };
			items.splice(openerIdx + 1, ci - openerIdx - 1, newItem);

			if (opener.count === 0) {
				items.splice(openerIdx, 1);
			}

			changed = true;
			break;
		}
	}

	// Convert remaining items to InlineNodes
	return resolveItems(raw, items);
}

/** Convert a list of items to InlineNode[], treating unmatched delimiters as text. */
function resolveItems(
	raw: string,
	items: Array<{ type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry }>
): InlineNode[] {
	const nodes: InlineNode[] = [];
	for (const item of items) {
		if (item.type === 'node') {
			nodes.push(item.node);
		} else {
			const e = item.entry;
			if (e.count > 0) {
				nodes.push({
					kind: 'text',
					start: e.start,
					end: e.start + e.count,
					text: raw.slice(e.start, e.start + e.count)
				});
			}
		}
	}
	return nodes;
}

// ── Post-processing ────────────────────────────────────────────────────────

/**
 * Walk the inline node tree and split text nodes on hard line break patterns.
 * Hard breaks: backslash immediately before \n, or two or more spaces before \n.
 * Single space before \n is NOT a hard break.
 */
function processHardLineBreaks(nodes: InlineNode[], raw: string): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		if (node.kind === 'text') {
			const split = splitTextOnHardBreaks(node, raw);
			for (const n of split) result.push(n);
		} else if (node.children && node.children.length > 0) {
			result.push({ ...node, children: processHardLineBreaks(node.children, raw) });
		} else {
			result.push(node);
		}
	}
	return result;
}

/**
 * Split a single text node on hard line break sequences.
 * Returns one or more nodes: text, hardLineBreak, text, ...
 */
function splitTextOnHardBreaks(node: InlineNode, raw: string): InlineNode[] {
	const { start, end } = node;
	const text = raw.slice(start, end);
	const result: InlineNode[] = [];
	let segStart = start;

	let i = 0;
	while (i < text.length) {
		const nlIdx = text.indexOf('\n', i);
		if (nlIdx === -1) break;

		const absNl = start + nlIdx;

		// Check for backslash break: char immediately before \n is '\'
		if (nlIdx > 0 && text[nlIdx - 1] === '\\') {
			// Text before the backslash
			const breakerStart = absNl - 1; // position of '\'
			if (segStart < breakerStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: breakerStart,
					text: raw.slice(segStart, breakerStart)
				});
			}
			// The hardLineBreak node covers the '\' and '\n'
			result.push({
				kind: 'hardLineBreak',
				start: breakerStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		// Check for two-or-more spaces before \n
		let spaceCount = 0;
		let j = nlIdx - 1;
		while (j >= 0 && text[j] === ' ') {
			spaceCount++;
			j--;
		}

		if (spaceCount >= 2) {
			const spacesStart = start + j + 1; // absolute start of the trailing spaces
			// Text before the trailing spaces
			if (segStart < spacesStart) {
				result.push({
					kind: 'text',
					start: segStart,
					end: spacesStart,
					text: raw.slice(segStart, spacesStart)
				});
			}
			// The hardLineBreak node covers the spaces + \n
			result.push({
				kind: 'hardLineBreak',
				start: spacesStart,
				end: absNl + 1
			});
			segStart = absNl + 1;
			i = nlIdx + 1;
			continue;
		}

		// Not a hard break — advance past the \n
		i = nlIdx + 1;
	}

	// Remaining text
	if (segStart < end) {
		result.push({
			kind: 'text',
			start: segStart,
			end: end,
			text: raw.slice(segStart, end)
		});
	}

	return result.length > 0 ? result : [node];
}

/** Merge adjacent text nodes into a single text node. */
function mergeAdjacentText(nodes: InlineNode[]): InlineNode[] {
	const result: InlineNode[] = [];
	for (const node of nodes) {
		const prev = result[result.length - 1];
		if (node.kind === 'text' && prev?.kind === 'text' && prev.end === node.start) {
			prev.end = node.end;
			prev.text = (prev.text ?? '') + (node.text ?? '');
		} else {
			result.push(node);
		}
	}
	return result;
}

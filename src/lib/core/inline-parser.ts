/**
 * Inline parser for prose block content (CST Phase 2).
 * Produces InlineNode trees from the content portion of raw text.
 * See docs/editor/inline-parsing-design.md for the design spec.
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

// ── Inline Parser ──────────────────────────────────────────────────────────

/**
 * Parse inline content within a prose block's raw text.
 * Returns an InlineNode[] tree covering the range [start, end) in raw.
 * All start/end offsets in returned nodes are relative to the full raw string.
 */
export function parseInline(raw: string, start: number, end: number): InlineNode[] {
	const codeSpans = scanBacktickSpans(raw, start, end);

	// Check if there are any delimiter characters in the text regions
	if (!hasDelimiterChars(raw, start, end, codeSpans)) {
		return codeSpans;
	}

	const segments = buildSegments(raw, start, end, codeSpans);
	const nodes = processEmphasis(raw, segments);
	return mergeAdjacentText(nodes);
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

// ── Delimiter Run Scanning (Stage 2) ───────────────────────────────────────

/** A delimiter run: a sequence of * or _ characters. */
interface DelimiterEntry {
	kind: '*' | '_';
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

/** Returns true if any text region between code spans contains * or _. */
function hasDelimiterChars(
	raw: string,
	start: number,
	end: number,
	codeSpans: InlineNode[]
): boolean {
	// Build occupied ranges from code spans
	const occupied: Array<{ s: number; e: number }> = codeSpans
		.filter(n => n.kind === 'inlineCode')
		.map(n => ({ s: n.start, e: n.end }));

	let pos = start;
	for (const { s, e } of occupied) {
		for (let i = pos; i < s; i++) {
			if (raw[i] === '*' || raw[i] === '_') return true;
		}
		pos = e;
	}
	for (let i = pos; i < end; i++) {
		if (raw[i] === '*' || raw[i] === '_') return true;
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
	kind: '*' | '_'
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

	if (kind === '*') {
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
 * Code spans (from stage 1) are inserted as 'node' segments; text regions
 * between them are scanned for delimiter runs.
 */
function buildSegments(
	raw: string,
	start: number,
	end: number,
	codeSpans: InlineNode[]
): Segment[] {
	const segments: Segment[] = [];

	// Partition into (text region, code span) pairs
	let pos = start;

	for (const node of codeSpans) {
		if (node.kind === 'inlineCode') {
			// Scan the text region before this code span for delimiters
			if (pos < node.start) {
				scanTextRegionForDelimiters(raw, pos, node.start, segments);
			}
			segments.push({ type: 'node', node });
			pos = node.end;
		}
		// 'text' nodes from stage 1 will be reconstructed during processing;
		// we only use code spans as anchors here.
	}

	// Remaining text after the last code span
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
		if (ch === '*' || ch === '_') {
			const runStart = pos;
			while (pos < end && raw[pos] === ch) pos++;
			const runEnd = pos;
			const count = runEnd - runStart;
			const { canOpen, canClose } = classifyRun(raw, runStart, runEnd, ch as '*' | '_');

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
					kind: ch as '*' | '_',
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

			// Determine consume count: strong (2) if both have ≥2, else emphasis (1)
			const consume = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
			const nodeKind: InlineNode['kind'] = consume === 2 ? 'strong' : 'emphasis';

			// The opener marker occupies the last `consume` chars of its run
			const openerMarkerStart = opener.end - consume;
			const openerMarkerEnd = opener.end;

			// The closer marker occupies the first `consume` chars of its run
			const closerMarkerStart = closer.start;
			const closerMarkerEnd = closer.start + consume;

			// Collect child nodes/delimiters between opener and closer
			const childItems = items.slice(openerIdx + 1, ci);
			const children = resolveItems(raw, childItems, openerMarkerEnd, closerMarkerStart);

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

			// If opener is exhausted, remove it (but keep its position reference for text)
			// We convert exhausted delimiters to text nodes
			if (opener.count === 0) {
				// The opener run is fully consumed; check if there's a preceding text portion
				if (opener.start < opener.end) {
					// Residual text from the opener (shouldn't exist when count==0, but safe)
				}
				// Remove the opener item; we already adjusted openerMarkerStart
				items.splice(openerIdx, 1);
				// ci shifts down by 1 because we removed openerIdx, and then replaced
				// openerIdx+1..ci-1 range above (now shifted). Re-scan from beginning.
				changed = true;
				break;
			} else {
				// Opener still has chars — it stays as a delimiter (partially consumed)
				changed = true;
				break;
			}
		}
	}

	// Convert remaining items to InlineNodes
	return resolveItems(raw, items, -1, -1);
}

/**
 * Convert a list of items to InlineNode[], treating unmatched delimiters as text.
 * start/end are the enclosing markers' boundaries (used to skip them if -1).
 */
function resolveItems(
	raw: string,
	items: Array<{ type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry }>,
	_innerStart: number,
	_innerEnd: number
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

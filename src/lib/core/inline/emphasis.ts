/**
 * Stages 2 and 3 of the inline parser pipeline: delimiter run scanning
 * (`*`, `_`, `~~`) and CommonMark emphasis matching. Bundled in one file
 * because `Segment` and `DelimiterEntry` pass between them and every
 * correctness change to delimiter semantics would touch both.
 */

import type { InlineNode } from '../nodes';

// ── Types ──────────────────────────────────────────────────────────────────

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
type Segment = { type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry };

// ── Delimiter Run Scanning ─────────────────────────────────────────────────

/** Returns true if any text region between occupied nodes contains *, _, or ~. */
export function hasDelimiterChars(
	raw: string,
	start: number,
	end: number,
	nodes: InlineNode[]
): boolean {
	// Build occupied ranges from all non-text nodes
	const occupied: Array<{ start: number; end: number }> = nodes
		.filter((n) => n.kind !== 'text')
		.map((n) => ({ start: n.start, end: n.end }));

	let pos = start;
	for (const { start: occStart, end: occEnd } of occupied) {
		for (let i = pos; i < occStart; i++) {
			if (raw[i] === '*' || raw[i] === '_' || raw[i] === '~') return true;
		}
		pos = occEnd;
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
export function buildSegments(
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
export function processEmphasis(raw: string, segments: Segment[]): InlineNode[] {
	// We'll work with a mutable array of items. Each item is either a node
	// or a delimiter entry. We repeatedly scan for a closer, find its opener,
	// wrap the content between them, and restart.

	// Clone segments into a working list
	type Item = { type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry };

	const items: Item[] = segments.map((s) =>
		s.type === 'node'
			? { type: 'node', node: s.node }
			: { type: 'delimiter', entry: { ...s.entry } }
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
			const entry = item.entry;
			if (entry.count > 0) {
				nodes.push({
					kind: 'text',
					start: entry.start,
					end: entry.start + entry.count,
					text: raw.slice(entry.start, entry.start + entry.count)
				});
			}
		}
	}
	return nodes;
}

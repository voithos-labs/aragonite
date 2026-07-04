/**
 * Inline pipeline stages 2–3: delimiter run scanning (`*`, `_`, `~~`) and
 * CommonMark emphasis matching. Bundled because Segment / DelimiterEntry
 * pass between them and correctness changes touch both.
 */

import type { InlineNode } from '../nodes';

// ── Types ──────────────────────────────────────────────────────────────────

interface DelimiterEntry {
	kind: '*' | '_' | '~';
	/** Characters remaining in the run — decremented as emphasis matches consume them. */
	count: number;
	origCount: number;
	start: number;
	end: number;
	canOpen: boolean;
	canClose: boolean;
}

type Segment = { type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry };

// ── Delimiter Run Scanning ─────────────────────────────────────────────────

/** Returns true if any text region between occupied nodes contains *, _, or ~. */
export function hasDelimiterChars(
	raw: string,
	start: number,
	end: number,
	nodes: InlineNode[]
): boolean {
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

/** Unicode punctuation (ASCII punctuation + general category P). */
function isPunct(ch: string): boolean {
	if (!ch) return false;
	const code = ch.codePointAt(0)!;
	if (
		(code >= 0x21 && code <= 0x2f) ||
		(code >= 0x3a && code <= 0x40) ||
		(code >= 0x5b && code <= 0x60) ||
		(code >= 0x7b && code <= 0x7e)
	) {
		return true;
	}
	return /^\p{P}$/u.test(ch);
}

function isWhitespace(ch: string): boolean {
	if (!ch) return true; // string boundary counts as whitespace
	return /\s/.test(ch);
}

// Flanking neighbors are read as full code points: a UTF-16 unit read would
// classify an astral neighbor as a lone surrogate ("other"), while the spec
// defines the character classes over code points.
function codePointBefore(raw: string, pos: number): string {
	const unit = raw.charCodeAt(pos - 1);
	if (unit >= 0xdc00 && unit <= 0xdfff && pos >= 2) {
		const high = raw.charCodeAt(pos - 2);
		if (high >= 0xd800 && high <= 0xdbff) return raw.slice(pos - 2, pos);
	}
	return raw[pos - 1];
}

function classifyRun(
	raw: string,
	runStart: number,
	runEnd: number,
	kind: '*' | '_' | '~'
): { canOpen: boolean; canClose: boolean } {
	const charBefore = runStart > 0 ? codePointBefore(raw, runStart) : '';
	const charAfter = runEnd < raw.length ? String.fromCodePoint(raw.codePointAt(runEnd)!) : '';

	const followedByWhitespace = isWhitespace(charAfter);
	const followedByPunct = isPunct(charAfter);
	const precededByWhitespace = isWhitespace(charBefore);
	const precededByPunct = isPunct(charBefore);

	const leftFlanking =
		!followedByWhitespace && (!followedByPunct || precededByWhitespace || precededByPunct);
	const rightFlanking =
		!precededByWhitespace && (!precededByPunct || followedByWhitespace || followedByPunct);

	if (kind === '*' || kind === '~') {
		return { canOpen: leftFlanking, canClose: rightFlanking };
	}
	// `_` has extra restrictions to avoid intra-word emphasis.
	const canOpen = leftFlanking && (!rightFlanking || precededByPunct);
	const canClose = rightFlanking && (!leftFlanking || followedByPunct);
	return { canOpen, canClose };
}

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
			if (pos < node.start) {
				scanTextRegionForDelimiters(raw, pos, node.start, segments);
			}
			segments.push({ type: 'node', node });
			pos = node.end;
		}
		// Existing text nodes get reconstructed by the delimiter scan; skip them here.
	}

	if (pos < end) {
		scanTextRegionForDelimiters(raw, pos, end, segments);
	}

	return segments;
}

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

			// `~` is only a strikethrough delimiter in runs of exactly 2; anything else is text.
			if (ch === '~' && count !== 2) {
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
 * CommonMark emphasis matching. Repeatedly finds the leftmost closer with a
 * valid opener, wraps the range, and restarts until no match remains.
 */
export function processEmphasis(raw: string, segments: Segment[]): InlineNode[] {
	type Item = { type: 'node'; node: InlineNode } | { type: 'delimiter'; entry: DelimiterEntry };

	const items: Item[] = segments.map((s) =>
		s.type === 'node'
			? { type: 'node', node: s.node }
			: { type: 'delimiter', entry: { ...s.entry } }
	);

	let changed = true;
	while (changed) {
		changed = false;

		for (let ci = 0; ci < items.length; ci++) {
			const closerItem = items[ci];
			if (closerItem.type !== 'delimiter') continue;
			const closer = closerItem.entry;
			if (!closer.canClose || closer.count === 0) continue;

			let openerIdx = -1;
			for (let oi = ci - 1; oi >= 0; oi--) {
				const openerItem = items[oi];
				if (openerItem.type !== 'delimiter') continue;
				const opener = openerItem.entry;
				if (!opener.canOpen || opener.count === 0) continue;
				if (opener.kind !== closer.kind) continue;

				// CommonMark multiple-of-3 rule — evaluated on ORIGINAL run lengths
				// (commonmark.js `origdelims`), not the decayed remainders.
				if (
					(opener.canClose || closer.canOpen) &&
					(opener.origCount + closer.origCount) % 3 === 0 &&
					!(opener.origCount % 3 === 0 && closer.origCount % 3 === 0)
				) {
					continue;
				}

				openerIdx = oi;
				break;
			}

			if (openerIdx === -1) continue;

			const openerItem = items[openerIdx] as { type: 'delimiter'; entry: DelimiterEntry };
			const opener = openerItem.entry;

			let consume: number;
			let nodeKind: InlineNode['kind'];
			if (opener.kind === '~') {
				consume = 2;
				nodeKind = 'strikethrough';
			} else {
				consume = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
				nodeKind = consume === 2 ? 'strong' : 'emphasis';
			}

			const openerMarkerStart = opener.end - consume;
			const closerMarkerEnd = closer.start + consume;

			const childItems = items.slice(openerIdx + 1, ci);
			const children = resolveItems(raw, childItems);

			const wrappedNode: InlineNode = {
				kind: nodeKind,
				start: openerMarkerStart,
				end: closerMarkerEnd,
				children
			};

			opener.count -= consume;
			opener.end -= consume;
			closer.count -= consume;
			closer.start += consume;

			items.splice(openerIdx + 1, ci - openerIdx - 1, { type: 'node', node: wrappedNode });

			if (opener.count === 0) {
				items.splice(openerIdx, 1);
			}

			changed = true;
			break;
		}
	}

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

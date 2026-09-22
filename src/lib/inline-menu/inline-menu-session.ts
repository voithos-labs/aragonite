/**
 * The inline menu's rules: which source a just-typed trigger opens, where in a line of prose it
 * may open at all, and what an open session's query is now. Pure, so all three are testable
 * without an editor.
 */

import { constructContentRange } from '../core/inline';
import type { InlineNode } from '../core/nodes';
import type { InlineMenuSource } from './types';

/** Identity only, never a captured node: every keystroke republishes the leaf. */
export interface InlineMenuSession {
	source: string;
	path: number[];
	/** Raw offset of the trigger's first byte. */
	start: number;
	triggerLength: number;
}

export interface InlineMenuOpening {
	source: InlineMenuSource;
	start: number;
}

/**
 * The source a just-typed run opens. `from` is where that run began: a burst of keystrokes
 * publishes as one change, so the trigger may sit anywhere in `[from, caret)`. The trigger
 * nearest the caret wins, and where two end at the same byte the longer does, so `[[` is never
 * read as a `[` source's press. A source that declines hands over to the next candidate.
 */
export function findOpening(
	sources: Iterable<InlineMenuSource>,
	raw: string,
	caret: number,
	from: number
): InlineMenuOpening | null {
	const candidates: { source: InlineMenuSource; start: number; end: number }[] = [];
	for (const source of sources) {
		const length = source.trigger.length;
		// A trigger counts when its last byte was typed in this run, so the second `[` of `[[`
		// opens over a first one that was already there.
		for (let end = Math.max(from + 1, length); end <= caret; end++) {
			if (raw.startsWith(source.trigger, end - length)) {
				candidates.push({ source, start: end - length, end });
			}
		}
	}
	candidates.sort((a, b) => b.end - a.end || b.source.trigger.length - a.source.trigger.length);
	for (const { source, start, end } of candidates) {
		if (source.opensAt && !source.opensAt(raw, start)) continue;
		if (!acceptsQuery(source, raw.slice(end, caret))) continue;
		return { source, start };
	}
	return null;
}

/** Bytes a reader never reads as prose, wherever the offset falls inside them. */
const NOT_PROSE_KINDS = new Set(['inlineCode', 'image', 'autolink', 'rawHtml']);

/**
 * Whether a trigger starting at this offset in the leaf's inline tree sits in prose the author is
 * writing. It does not inside an inline code span, an image, an autolink or raw HTML, nor in a
 * link's destination or title; a link's own text is prose and a trigger there opens.
 */
export function isProseOffset(nodes: InlineNode[], offset: number): boolean {
	for (const node of nodes) {
		if (offset < node.start || offset >= node.end) continue;
		if (NOT_PROSE_KINDS.has(node.kind)) return false;
		if (node.kind === 'link') {
			const text = constructContentRange(node);
			if (!text || offset < text.start || offset >= text.end) return false;
		}
		return node.children ? isProseOffset(node.children, offset) : true;
	}
	return true;
}

/**
 * Where the run the author just typed began, or null if the change from `previous` to `raw` is
 * anything other than bytes inserted so as to end at the caret: a deletion, a caret that only
 * moved, an edit elsewhere in the leaf.
 */
export function typedRunStart(previous: string, raw: string, caret: number): number | null {
	const length = raw.length - previous.length;
	if (length <= 0 || length > caret) return null;
	const from = caret - length;
	return raw.slice(0, from) + raw.slice(caret) === previous ? from : null;
}

function acceptsQuery(source: InlineMenuSource, query: string): boolean {
	return source.accepts ? source.accepts(query) : !/[\r\n]/.test(query);
}

/**
 * The open session's query at this caret, or null once the session is over: the trigger's bytes
 * are gone, the caret stepped out in front of the query, or the source declines what was typed.
 */
export function sessionQuery(
	session: InlineMenuSession,
	source: InlineMenuSource,
	raw: string,
	caret: number
): string | null {
	const queryStart = session.start + session.triggerLength;
	if (caret < queryStart || caret > raw.length) return null;
	if (!raw.startsWith(source.trigger, session.start)) return null;
	const query = raw.slice(queryStart, caret);
	return acceptsQuery(source, query) ? query : null;
}

/** Step the active row, wrapping at both ends; a list of none has no active row. */
export function stepActive(index: number, delta: 1 | -1, count: number): number {
	if (count === 0) return 0;
	return (index + delta + count) % count;
}

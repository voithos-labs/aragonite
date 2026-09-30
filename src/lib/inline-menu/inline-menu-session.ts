/**
 * The inline menu's rules: which source a just-typed trigger opens, where in a line of prose it
 * may open at all, and what an open session's query is now. Pure, so all three are testable
 * without an editor.
 */

import { constructContentRange } from '../core/inline';
import { isInlineWidgetKind } from '../core/inline/inline-widgets';
import type { AnyInlineKind, InlineNode } from '../core/nodes';
import type { GrammarView } from '../schema/block-openers';
import {
	getInlineConstructPolicy,
	type InlineProseExtent
} from '../schema/inline-construct-policy';
import type { InlineMenuSource } from './types';

/** Identity only, never a captured node: every keystroke writes a new leaf to state. */
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

/** The source a just-typed run opens; `from` is where the run began, since a burst of keystrokes
 *  arrives as one change. The trigger nearest the caret wins, then the longer, so `[[` beats `[`. */
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

/** Whether a trigger at this offset sits in prose the author is writing, as each construct's
 *  policy row declares: a link's text is prose, its destination and a code span are not. */
export function isProseOffset(nodes: InlineNode[], offset: number, grammar: GrammarView): boolean {
	for (const node of nodes) {
		if (offset < node.start || offset >= node.end) continue;
		const extent = proseExtent(node.kind, grammar);
		if (extent === 'none') return false;
		if (extent === 'content') {
			const content = constructContentRange(node);
			if (!content || offset < content.start || offset >= content.end) return false;
		}
		return node.children ? isProseOffset(node.children, offset, grammar) : true;
	}
	return true;
}

// A widget kind with no row (a plugin's formula) shows source, never prose.
function proseExtent(kind: AnyInlineKind, grammar: GrammarView): InlineProseExtent {
	const declared = getInlineConstructPolicy(kind)?.prose;
	return declared ?? (isInlineWidgetKind(kind, grammar) ? 'none' : 'all');
}

/** Whether the offset sits in a destination opened with `](` and not yet closed: those bytes are
 *  text until the `)` lands, so the inline tree has no link to decline. */
export function isUnclosedDestination(raw: string, offset: number): boolean {
	const lineStart = raw.lastIndexOf('\n', offset - 1) + 1;
	for (let i = offset - 1; i >= lineStart; i--) {
		if (raw[i] === ')') return false;
		// A `](` with no `[` before it on the line is text, so the scan keeps going back.
		if (raw[i] === '(' && raw[i - 1] === ']' && raw.lastIndexOf('[', i - 2) >= lineStart) {
			return true;
		}
	}
	return false;
}

/** Where the just-typed run began, or null when the change from `previous` to `raw` is anything
 *  but bytes inserted to end at the caret (a deletion, a caret move, an edit elsewhere). */
export function typedRunStart(previous: string, raw: string, caret: number): number | null {
	const length = raw.length - previous.length;
	if (length <= 0 || length > caret) return null;
	const from = caret - length;
	return raw.slice(0, from) + raw.slice(caret) === previous ? from : null;
}

function acceptsQuery(source: InlineMenuSource, query: string): boolean {
	return source.accepts ? source.accepts(query) : !/[\r\n]/.test(query);
}

/** The open session's query at this caret, or null once the session is over: the trigger is
 *  gone, the caret stepped in front of the query, or the source declines what was typed. */
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

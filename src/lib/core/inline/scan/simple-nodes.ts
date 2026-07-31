/**
 * Single-construct handlers: backslash (escape / hard break), ampersand
 * (character reference), newline (trailing-spaces hard break). Each either
 * appends its node or leaves the dispatch character to the pending text run.
 */

import { matchCharacterReference } from '../character-refs';
import { ESCAPABLE_PUNCTUATION } from '../../escapable';
import { appendNode, type ScanContext } from './scan-state';

export function handleBackslash(ctx: ScanContext): void {
	const { raw, pos, end } = ctx;
	if (pos + 1 < end && raw[pos + 1] === '\n') {
		appendNode(ctx, { kind: 'hardLineBreak', start: pos, end: pos + 2 });
		return;
	}
	if (pos + 2 < end && raw[pos + 1] === '\r' && raw[pos + 2] === '\n') {
		appendNode(ctx, { kind: 'hardLineBreak', start: pos, end: pos + 3 });
		return;
	}
	if (pos + 1 < end && ESCAPABLE_PUNCTUATION.has(raw[pos + 1])) {
		appendNode(ctx, { kind: 'escape', start: pos, end: pos + 2 });
		return;
	}
	ctx.pos++;
}

export function handleAmpersand(ctx: ScanContext): void {
	const ref = matchCharacterReference(ctx.raw, ctx.pos, ctx.end);
	if (ref !== null) appendNode(ctx, ref);
	else ctx.pos++;
}

/**
 * §6.7 trailing-spaces form: two-plus spaces before the newline become a hardLineBreak covering
 * spaces + newline; one space is a softbreak. Lookback is clamped to the pending text run, so
 * spaces inside an already-consumed node cannot count.
 */
export function handleNewline(ctx: ScanContext): void {
	const { raw, pos, textStart } = ctx;
	let i = pos - 1;
	if (i >= textStart && raw[i] === '\r') i--;
	let spaces = 0;
	while (i >= textStart && raw[i] === ' ') {
		spaces++;
		i--;
	}
	if (spaces >= 2) {
		appendNode(ctx, { kind: 'hardLineBreak', start: i + 1, end: pos + 1 });
	} else {
		ctx.pos++;
	}
}

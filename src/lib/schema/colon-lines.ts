/**
 * The lines of a `:::name` container, which bring their own writer so an app that never turns
 * directives on ships neither it nor the directive grammar it reads.
 */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import { ownTrailingLineEnding, trimTrailingLineEnding } from '../core/lines';
import { WRITES_LINES, type ColonLines } from '../core/strip-lines';
import { escalatedColonCount, matchDirectiveOpener } from '../core/directive/grammar';

/** A `:::name` container: the opener line (child 0) as it stands, the body, then a closing line as
 *  long as the one it replaces, every colon run widened past a body line that would close it. */
export const COLON_LINES: ColonLines = { shape: 'colon', [WRITES_LINES]: writeColon };

function writeColon(node: CstNode): void {
	const [row, ...body] = node.children!;
	const line = row ? trimTrailingLineEnding(row.raw) : '';
	const fence = matchDirectiveOpener(line);
	const ending = (row && ownTrailingLineEnding(row.raw)) || '\n';
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const closer = closingLine(node.raw, fence?.colonCount ?? 3);
	const closerEnding = closer.newline ? ownTrailingLineEnding(node.raw) || ending : '';
	// A line that stopped opening a fence is kept as typed; the re-read reads what it now is.
	if (!fence) {
		node.raw = line + ending + inner + ':'.repeat(closer.colons) + closerEnding;
		return;
	}
	const colons = escalatedColonCount(inner, fence.colonCount);
	const opener = ':'.repeat(colons) + fence.name + fence.info;
	node.raw = opener + ending + inner + ':'.repeat(Math.max(colons, closer.colons)) + closerEnding;
}

/** The closing line's colon count, and whether a line ending follows it, in the bytes `raw` holds. */
function closingLine(raw: string, fallback: number): { colons: number; newline: boolean } {
	const text = trimTrailingLineEnding(raw);
	const last = text.slice(text.lastIndexOf('\n') + 1);
	const colons = /^:+$/.test(last) ? last.length : fallback;
	return { colons, newline: ownTrailingLineEnding(raw) !== '' };
}

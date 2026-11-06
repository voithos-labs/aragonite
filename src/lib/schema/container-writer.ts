/**
 * Writes a container's bytes from its children: through the line shape its kind states, or, for a
 * list, a table and a kind registered with its own rebuild, through that. `writeContainerRaw` is
 * the one way in, and the one reader of either.
 */

import type { CstNode } from '../core/nodes';
import { concatChildren } from '../core/serializer';
import {
	firstDisplayLine,
	firstLineEnding,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '../core/lines';
import {
	codecFromShape,
	WRITES_LINES,
	type ColonLines,
	type FencedLines,
	type IndentedLines,
	type LineShape,
	type MarkedLines
} from '../core/strip-lines';
import { escalatedColonCount, matchDirectiveOpener } from '../core/directive/grammar';
import { tryGetBlockKindDescriptor } from './block-kind-descriptor';
import type { GrammarView } from './block-openers';
import { dropChildSpans, type ChildRawChange } from './child-spans';
import { bodyHasNoBytes, rebuildStripRaw, type StripRebuild } from './strip-rebuild';

/** `node`'s bytes written from its children as `grammar` reads them; `changed` names the one child
 *  whose bytes moved. */
export function writeContainerRaw(
	node: CstNode,
	grammar: GrammarView,
	changed?: ChildRawChange
): StripRebuild | undefined {
	const descriptor = tryGetBlockKindDescriptor(node.kind);
	if (descriptor?.lines) return writeShapedRaw(node, descriptor.lines, grammar, changed);
	return descriptor?.rebuildRaw?.(node, changed) ?? undefined;
}

function writeShapedRaw<D>(
	node: CstNode,
	shape: LineShape<D>,
	grammar: GrammarView,
	changed?: ChildRawChange
): StripRebuild | undefined {
	if (!node.children) return;
	if (shape.shape === 'indented') return writeIndented(node, shape, grammar, changed);
	if (shape.shape !== 'marked') {
		shape[WRITES_LINES](node);
		return;
	}
	if (shape.head) return writeHeaded(node, shape, grammar, changed);
	return rebuildStripRaw(node, codecFromShape(shape), { grammar, changed });
}

/** The data a container is written under: its metadata, over what its old first line reads. */
function dataOver<D>(node: CstNode, read: D | undefined): D {
	return { ...read, ...node.metadata } as D;
}

/** The previous bytes are read under the marker their own first line was written with. */
function writeIndented<D>(
	node: CstNode,
	shape: IndentedLines<D>,
	grammar: GrammarView,
	changed: ChildRawChange | undefined
): StripRebuild {
	const match = shape.open.exec(firstDisplayLine(node.raw).text);
	const was = match ? shape.data(match) : undefined;
	const data = dataOver(node, was);
	const lines = codecFromShape(shape, data);
	const previous =
		was !== undefined && shape.first(was) !== shape.first(data)
			? codecFromShape(shape, was)
			: lines;
	return rebuildStripRaw(node, lines, { grammar, changed, previous });
}

/** The head line written from the data, the body as the shape's lines below it; an emptied body
 *  leaves the head line alone, which still opens the container. */
function writeHeaded<D>(
	node: CstNode,
	shape: MarkedLines<D>,
	grammar: GrammarView,
	changed: ChildRawChange | undefined
): StripRebuild | undefined {
	const head = shape.head!;
	const old = firstDisplayLine(node.raw).text;
	const marker = shape.reads.exec(old);
	const read = marker ? head.match.exec(old.slice(marker[0].length)) : null;
	const line = shape.first + head.write(dataOver(node, read ? head.data(read) : undefined));
	if (!node.innerPrefix && bodyHasNoBytes(node)) {
		node.raw = line + ownTrailingLineEnding(node.raw);
		dropChildSpans(node);
		return;
	}
	return rebuildStripRaw(node, codecFromShape(shape), { grammar, changed, opener: line });
}

// ── Shapes that bring their writer ───────────────────────────────────────────

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

/** A container with opening lines written from its data and title row (child 0), and a closing
 *  line; every line takes the opening line's ending, the closing one only where it had one. */
export function fencedLines<D>(write: FencedLines<D>['write']): FencedLines<D> {
	return { shape: 'fenced', write, [WRITES_LINES]: (node) => writeFenced(node, write) };
}

function writeFenced<D>(node: CstNode, write: FencedLines<D>['write']): void {
	const [row, ...body] = node.children!;
	const data = (node.metadata ?? {}) as D;
	const ending = firstLineEnding(node.raw) ?? '\n';
	const title = row ? trimTrailingLineEnding(row.raw) : '';
	const opening = write.open(data, title).map((line) => line + ending);
	const inner = (node.innerPrefix ?? '') + concatChildren(body) + (node.innerSuffix ?? '');
	const closer = write.close(data) + (ownTrailingLineEnding(node.raw) ? ending : '');
	node.raw = opening.join('') + inner + closer;
}

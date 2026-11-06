/**
 * Writes a container's bytes from its children: through the line shape its kind states, or, for a
 * list, a table and a kind registered with its own rebuild, through that. `writeContainerRaw` is
 * the one way in, and the one reader of either.
 */

import type { CstNode } from '../core/nodes';
import { firstDisplayLine, ownTrailingLineEnding } from '../core/lines';
import {
	codecFromShape,
	WRITES_LINES,
	type IndentedLines,
	type LineShape,
	type MarkedLines
} from '../core/strip-lines';
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

/** The head line, kept as spelled while it writes the same data, the body as the shape's lines
 *  below it; an emptied body leaves the head line alone, which still opens the container. */
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
	const was = read ? head.data(read) : undefined;
	const written = head.write(dataOver(node, was));
	const line = was !== undefined && head.write(was) === written ? old : shape.first + written;
	if (!node.innerPrefix && bodyHasNoBytes(node)) {
		node.raw = line + ownTrailingLineEnding(node.raw);
		dropChildSpans(node);
		return;
	}
	return rebuildStripRaw(node, codecFromShape(shape), { grammar, changed, opener: line });
}

// A full quote or list item rebuild that keeps a matched line without reading it again, against
// the same rebuild reading every kept line again: equal bytes, spans and rereads.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { CstNode } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { firstDisplayLine, splitLines } from '$lib/core/lines';
import { quoteLines } from '$lib/core/parsers/blockquote';
import { listItemLines, readItemShape } from '$lib/core/parsers/list';
import type { LineCodec } from '$lib/core/strip-lines';
import { rebuildConcatRaw, rebuildStripRaw } from '$lib/schema/child-spans';
import { arbRespelledContainerDoc, freshOrFixedSeed } from './arbitraries';

const PARAMS = { numRuns: 400, seed: freshOrFixedSeed(292929) } as const;

const EDITS = ['none', 'typed', 'lineAdded', 'lineDropped', 'blankAppended'] as const;
type Edit = (typeof EDITS)[number];

/** The leaf's bytes after `edit`, which moves the lines the rebuild pairs by text. */
function edited(raw: string, edit: Edit): string {
	const lines = splitLines(raw);
	if (lines.length === 0) return raw;
	const first = lines[0];
	switch (edit) {
		case 'none':
			return raw;
		case 'typed':
			return first.text + 'Z' + raw.slice(first.text.length);
		case 'lineAdded':
			return first.raw + 'added' + (first.lineEnding || '\n') + raw.slice(first.raw.length);
		case 'lineDropped':
			return lines.length > 1 ? raw.slice(0, lines.at(-1)!.start) : raw;
		case 'blankAppended':
			return raw.endsWith('\n') ? raw + '\n' : raw;
	}
}

function leavesOf(nodes: readonly CstNode[]): CstNode[] {
	return nodes.flatMap((node) => (node.children ? leavesOf(node.children) : [node]));
}

/** The node's line syntax, read off its first line as its own rebuild reads it. */
function codecOf(node: CstNode): LineCodec | null {
	if (node.kind === 'blockquote') return quoteLines;
	const shape = node.kind === 'listItem' ? readItemShape(firstDisplayLine(node.raw).text) : null;
	return shape ? listItemLines(shape) : null;
}

/** Every list, quote and list item rebuilt innermost first; `rereadAll` hands the rebuild a copy
 *  of the syntax to read the previous bytes with, so no kept line counts as already read. */
function rebuildAll(nodes: readonly CstNode[], rereadAll: boolean): unknown[] {
	return nodes.flatMap((node) => {
		if (!node.children) return [];
		const inner = rebuildAll(node.children, rereadAll);
		if (node.kind === 'list') {
			rebuildConcatRaw(node);
			return [...inner, node.raw];
		}
		const codec = codecOf(node);
		if (!codec) return inner;
		const { rereads } = rebuildStripRaw(node, codec, undefined, rereadAll ? { ...codec } : codec);
		return [...inner, node.raw, Array.from(node.childSpans ?? []), rereads];
	});
}

function writeBoth(source: string, pick: number, edit: Edit): void {
	const runs = [false, true].map((rereadAll) => {
		const doc = parse(source);
		const leaves = leavesOf(doc.children);
		const leaf = leaves[pick % leaves.length];
		leaf.raw = edited(leaf.raw, edit);
		return rebuildAll(doc.children, rereadAll);
	});
	expect(runs[0]).toEqual(runs[1]);
}

describe('a full strip rebuild keeps a matched line without reading it again', () => {
	it('writes what reading every kept line again writes', () => {
		fc.assert(
			fc.property(
				arbRespelledContainerDoc,
				fc.nat({ max: 20 }),
				fc.constantFrom(...EDITS),
				writeBoth
			),
			PARAMS
		);
	});
});

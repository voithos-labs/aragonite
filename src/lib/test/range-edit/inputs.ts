// The inputs the range-edit laws run over, drawn from a seed rather than read from files: documents
// the law harness draws, each in both modes, with two ranges and a caret each. A range resolves on
// the tree the editor opens and is widened to bytes the way the editor widens a selection.

import fc from 'fast-check';
import type { DocumentView } from '#lib/core/node-views.js';
import { metadataOf } from '#lib/core/nodes.js';
import { ownTrailingLineEnding } from '#lib/core/lines.js';
import { serialize } from '#lib/core/serializer.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { blockNodeAt } from '#lib/tree-operations/node-primitives.js';
import { hasTextPosition } from '#lib/schema/block-facts.js';
import type { Range } from '#lib/range-edit/edit-range.js';
import type { Mode } from '#lib/range-edit/host.js';
import { documentLayout } from '#lib/range-edit/layout.js';
import { arbClipboardText, arbLawDocument } from '../range-laws/shapes';
import { arbEnd, arbRangeSeed, resolveCaret, resolveRange } from '../range-laws/ranges';

export interface LawInput {
	source: string;
	mode: Mode;
	/** Each with the clipboard text a paste over it writes. */
	ranges: { from: number; to: number; text: string }[];
	carets: { at: number; texts: string[] }[];
}

/** `count` documents from `seed`, each in both modes, with their ranges and carets. */
export function lawInputs(count: number, seed: number, grammar: GrammarView): LawInput[] {
	const clips = fc.sample(arbClipboardText, { numRuns: 400, seed: seed + 1 });
	const sources = fc.sample(arbLawDocument, { numRuns: count, seed });
	return sources.flatMap((source, d) => {
		const doc = readAsOpened(source, { grammar, scope: 'document' });
		return (['source', 'live'] as const).map((mode, m) => {
			const n = d * 2 + m;
			const ranges = fc
				.sample(arbRangeSeed, { numRuns: 2, seed: seed + 7 * n })
				.flatMap((rangeSeed, i) => {
					const via = resolveRange(doc, rangeSeed);
					const bytes = via && bytesOfRange(doc, via, mode);
					return bytes ? [{ ...bytes, text: clips[(n * 3 + i) % clips.length] }] : [];
				});
			const caretSeed = fc.sample(arbEnd, { numRuns: 1, seed: seed + 7 * n + 3 })[0];
			const via = resolveCaret(doc, caretSeed);
			const at = via && documentLayout(doc).byteOf(via.anchor.path, via.anchor.offset);
			const texts = [clips[(n * 5) % clips.length], clips[(n * 5 + 2) % clips.length]];
			return {
				source,
				mode,
				ranges,
				carets: at === null || at === undefined ? [] : [{ at, texts }]
			};
		});
	});
}

/** The editor's range as the core receives it, widened to each block it takes whole or ends inside
 *  with no text position; null for a pair inside one table, which the editor keeps to itself. */
function bytesOfRange(doc: DocumentView, selection: EditorSelection, mode: Mode): Range | null {
	const covered = coverRange(doc, selection.anchor, selection.focus);
	const { start, end } = covered;
	if (start.cellCoordinate && end.cellCoordinate && start.path.join() === end.path.join())
		return null;
	const layout = documentLayout(doc);
	const blocks = [...layout.within(0, Infinity)];
	const blockAt = (path: readonly number[]) => blocks.find((b) => b.path.join() === path.join());
	const at = (point: SelectionPoint, side: 'start' | 'end'): number | null => {
		if (!point.cellCoordinate) return layout.byteOf(point.path, point.offset);
		const table = blockNodeAt(doc, point.path);
		if (!table) return null;
		const row = blockAt([
			...point.path,
			Math.floor(point.offset / metadataOf(table, 'table').columnCount)
		]);
		return row ? (side === 'start' ? row.from : row.to) : null;
	};
	let from = at(start, 'start');
	let to = at(end, 'end');
	if (from === null || to === null) return null;
	// A block held whole ends where its last line's text does; its kind takes the line with it.
	const textEnd = (path: readonly number[], to: number) =>
		to - ownTrailingLineEnding(blockNodeAt(doc, path)!.raw).length;
	for (const root of rangeCoverage(doc, covered).wholeRoots) {
		const block = blockAt(root);
		if (!block) return null;
		from = Math.min(from, block.from);
		to = Math.max(to, textEnd(root, block.to));
	}
	for (const block of blocks) {
		if (block.lines || hasTextPosition(block.type, mode === 'source')) continue;
		const end = textEnd(block.path, block.to);
		if (block.from < from && from < end) from = block.from;
		if (block.from < to && to < end) to = end;
	}
	// The editor never puts an end between a line's `\r` and its `\n`.
	const source = serialize(doc);
	const offPair = (at: number) => (source[at - 1] === '\r' && source[at] === '\n' ? at - 1 : at);
	return { from: offPair(from), to: offPair(to) };
}

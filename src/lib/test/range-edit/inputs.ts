// The inputs the range-edit laws run over, drawn from a seed rather than read from files: documents
// the law harness draws, each in both modes, with two ranges and a caret each. A range resolves on
// the tree the editor opens and is widened to bytes the way the editor widens a selection.

import fc from 'fast-check';
import type { DocumentView } from '#lib/core/node-views.js';
import { serialize } from '#lib/core/serializer.js';
import type { GrammarView } from '#lib/schema/block-openers.js';
import { readAsOpened } from '#lib/schema/opened-reading.js';
import type { EditorSelection, SelectionPoint } from '#lib/selection/primitives.js';
import { coverRange, rangeCoverage } from '#lib/selection/range-coverage.js';
import { normalizeCharEndpoint } from '#lib/selection/char-endpoint-snap.js';
import { pathsEqual } from '#lib/selection/path-math.js';
import { rangeBytes } from '#lib/selection/range-bytes.js';
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
					const bytes = via && bytesOfRange(doc, via);
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

/** The editor's range as the core receives it, its ends snapped as the selection snaps them and
 *  read by the editor's own adapter; null for a pair inside one table. */
function bytesOfRange(doc: DocumentView, selection: EditorSelection): Range | null {
	const { anchor, focus } = selection;
	const snapped = (point: SelectionPoint, other: SelectionPoint) =>
		point.cellCoordinate || pathsEqual(point.path, other.path)
			? point
			: normalizeCharEndpoint(doc, point, other.path);
	const covered = coverRange(doc, snapped(anchor, focus), snapped(focus, anchor));
	return rangeBytes(doc, serialize(doc), rangeCoverage(doc, covered));
}

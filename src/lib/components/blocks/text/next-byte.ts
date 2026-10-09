/**
 * The constructs the next typed letter would sit inside, answered the way typing writes it: pending
 * marks through the insertion a chord promised, otherwise the caret memory's records and the block's
 * move across a hidden edge, run dry on a probe letter. The drawn caret's look and the edge ring both
 * read it, so what the caret shows is what the letter becomes.
 */

import type { InlineNode } from '../../../core/nodes';
import type { NodeView } from '../../../core/node-views';
import type { NextByte } from '../../../caret/caret-look';
import type { CaretMemory } from '../../../caret/caret-memory';
import type { PreviewInsertion, TextEdit } from '../../../caret/next-insertion';
import { revealsNoMarkers } from '../../../caret/widget-offset';
import { constructContentRange } from '../../../core/inline';
import { resolvedInlineContent } from '../../../core/inline/inline-cache';
import { trimTrailingLineEnding } from '../../../core/lines';
import { listInlineMarks, type InlineMarkKind } from '../../../schema/inline-construct-policy';
import type { Reading } from '../../../schema/reading';
import { recordCaretLook } from '../../../perf/instruments';
import { PROBE_BYTE } from './edge-seat';
import { withOwnEnding } from '../surface-write';
import { constructChainAt, resolveMarkedInsertion } from './pending-mark-insert';

/** What the answer reads off one block at one moment. */
export interface NextByteBlock {
	/** The block's displayed text: its bytes less the trailing line ending, as a write sees them. */
	display: string;
	/** The inline tree of `display`, read with `reading`. */
	inlines: readonly InlineNode[];
	reading: Reading;
	/** The marks a format chord promised the next letter, or null. */
	pendingMarks: ReadonlySet<InlineMarkKind> | null;
	/** The caret memory's records for this block, run dry with the block's placement. */
	preview: PreviewInsertion;
	/** The inline tree of a rewritten `display`. */
	inlinesOf(display: string): readonly InlineNode[];
}

/** The marks a letter typed at raw offset `caret` would carry. */
export function nextByte(caret: number, block: NextByteBlock): NextByte {
	const { display, pendingMarks } = block;
	if (pendingMarks) {
		const marked = resolveMarkedInsertion(
			display,
			caret,
			PROBE_BYTE,
			pendingMarks,
			block.inlines,
			block.reading
		);
		// The chord's write spends the records in place; where no insertion fits, the key types plain.
		if (marked) {
			recordCaretLook('caretLookPreviews');
			const written = { text: marked.raw, caretAfter: marked.caret };
			return marksOfLetter(block.preview.spendInPlace(display, written), block);
		}
	} else if (typesInPlace(display, caret) && !block.preview.waitsAt(caret)) {
		const chain = constructChainAt(caret, block.inlines, () =>
			recordCaretLook('caretLookNodeVisits')
		);
		return { marks: markKinds(new Set(chain.map((node) => node.kind))) };
	}
	recordCaretLook('caretLookPreviews');
	const typed = {
		text: display.slice(0, caret) + PROBE_BYTE + display.slice(caret),
		caretAfter: caret + PROBE_BYTE.length
	};
	return marksOfLetter(block.preview.spend(display, typed, caret), block);
}

/** One block's live reads, for `createNextByte`. */
export interface NextByteSource {
	getEl(): HTMLElement | null;
	getNode(): NodeView;
	getInlines(): readonly InlineNode[];
	reading: Reading;
	caretMemory: Pick<CaretMemory, 'pendingMarks' | 'changeCount'>;
	/** The memory's records for this block, run dry with its placement. */
	preview(): PreviewInsertion;
}

/** `nextByte` for one block, kept until its inline tree, the caret, the caret memory or whether its
 *  screen hides markers changes: a typed key paints twice, and the second paint finds the answer. */
export function createNextByte(source: NextByteSource): (caret: number) => NextByte {
	let last: { key: readonly unknown[]; next: NextByte } | null = null;
	return (caret) => {
		const el = source.getEl();
		const inlines = source.getInlines();
		const key = [inlines, caret, source.caretMemory.changeCount(), !!el && revealsNoMarkers(el)];
		if (last && key.every((part, i) => part === last!.key[i])) return last.next;
		recordCaretLook('caretLookComputes');
		const node = source.getNode();
		const next = nextByte(caret, {
			display: trimTrailingLineEnding(node.raw),
			inlines,
			reading: source.reading,
			pendingMarks: source.caretMemory.pendingMarks.get(),
			preview: source.preview(),
			inlinesOf: (text) =>
				resolvedInlineContent({ ...node, raw: withOwnEnding(node, text) }, source.reading)
		});
		last = { key, next };
		return next;
	};
}

/** Whether a letter typed at `caret` changes no construct around it: every delimiter is
 *  punctuation, and with none beside the caret, no delimiter run's neighbours change. */
export function typesInPlace(display: string, caret: number): boolean {
	return isPlain(characterBefore(display, caret)) && isPlain(characterAt(display, caret));
}

// ── Internal ────────────────────────────────────────────────────────────────

/** A letter, a digit, a combining mark or a space: nothing that opens or closes a construct. */
const PLAIN = /^[\p{L}\p{N}\p{M}\s]$/u;

/** No character at all (the text's edge) is plain too. */
const isPlain = (character: string): boolean => character === '' || PLAIN.test(character);

/** The character starting at `at`, a surrogate pair whole. */
function characterAt(display: string, at: number): string {
	const point = display.codePointAt(at);
	return point === undefined ? '' : String.fromCodePoint(point);
}

/** The character ending at `at`, a surrogate pair whole. */
function characterBefore(display: string, at: number): string {
	if (at <= 0) return '';
	const low = display.charCodeAt(at - 1);
	const pair = at >= 2 && low >= 0xdc00 && low <= 0xdfff;
	return characterAt(display, pair ? at - 2 : at - 1);
}

/** The marks over the probe letter `edit` wrote, the one before its caret. */
function marksOfLetter(edit: TextEdit, block: NextByteBlock): NextByte {
	recordCaretLook('caretLookParses');
	const at = edit.caretAfter - PROBE_BYTE.length;
	const kinds = new Set<string>();
	for (let level: readonly InlineNode[] | undefined = block.inlinesOf(edit.text); level;) {
		const holder: InlineNode | undefined = level.find((node) => covers(node, at));
		if (!holder) break;
		kinds.add(holder.kind);
		level = holder.children;
	}
	return { marks: markKinds(kinds) };
}

/** Whether the letter at `at` is this construct's content. */
function covers(node: InlineNode, at: number): boolean {
	if (node.kind === 'text') return false;
	const content = constructContentRange(node) ?? node;
	return content.start <= at && at < content.end;
}

/** The kinds among `kinds` a format chord writes, in the policy table's nesting order. */
function markKinds(kinds: ReadonlySet<string>): InlineMarkKind[] {
	return listInlineMarks()
		.map((entry) => entry.kind)
		.filter((kind) => kinds.has(kind));
}

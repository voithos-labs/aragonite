/**
 * A block kind's facts for cut, copy and paste, as data: how its lines carry its markers, which
 * containers a pasted one joins, what its text reads as, and whether a caret can sit in it. Read
 * from the kind's registration alone (no view, no DOM, no presentation mode), so any gesture can
 * ask per block.
 */

import type { AnyBlockKind } from '../core/nodes';
import { isDirectiveContainerKind } from '../core/directive/registry';
import {
	mustHoldChild,
	tryGetBlockKindDescriptor,
	type BlockKindDescriptor,
	type MergeRole
} from './block-kind-descriptor';
import { reservedChromeKindOf, rowIsOpenerLine } from './reserved-chrome';

export interface BlockFacts {
	/** It holds blocks a caret enters; a container focused as one unit doesn't. */
	container: boolean;
	/** How its lines carry its markers; `items` is a list's, `rows` a table's, `cells` a row's. */
	lines: 'every-line' | 'first-line' | 'fenced' | 'items' | 'rows' | 'cells' | 'none';
	/** A line without its marker still continues a paragraph open inside it. */
	lazyParagraphLines: boolean;
	/** The columns a line after the first takes, where that isn't the first line's marker width. */
	indent?: number;
	/** The kinds a pasted block of this kind joins rather than nesting in, the metadata field both
	 *  must share, and what a same-kind block with another value does. */
	merges: { into: string[]; key?: string; onMismatch: 'nest' | 'break-out' };
	/** An item joining it takes the list's marker and next number. */
	countsMarkers: boolean;
	/** Its one-line first child, kept as a title; the name in it is never entered when the row is
	 *  the container's opening line. */
	titleRow?: { type: string; nameNeverEntered: boolean };
	body: 'markdown' | 'literal';
	/** What text joined to its end from below does: `into-deepest` lands in its deepest text block. */
	joins: 'text' | 'text-keeping-type' | 'into-deepest' | 'same-type' | 'never';
	/** Whether a caret can sit in its text: a block drawn as a picture of its source only while that
	 *  source shows. */
	textPosition: 'always' | 'never' | 'while-source-shows';
}

export function blockFacts(kind: string): BlockFacts {
	const descriptor = tryGetBlockKindDescriptor(kind as AnyBlockKind);
	const container = mustHoldChild(kind as AnyBlockKind);
	const lines = container ? linesOf(kind, descriptor) : 'none';
	const titleRow = reservedChromeKindOf(kind as AnyBlockKind);
	return {
		container,
		lines,
		lazyParagraphLines: container && (descriptor?.lines?.lazy ?? false),
		...(container && descriptor?.lines?.indent !== undefined
			? { indent: descriptor.lines.indent }
			: {}),
		merges: container ? mergesOf(kind, descriptor, lines) : { into: [], onMismatch: 'nest' },
		countsMarkers: lines === 'items',
		...(titleRow
			? { titleRow: { type: titleRow, nameNeverEntered: rowIsOpenerLine(kind as AnyBlockKind) } }
			: {}),
		body: descriptor?.supportsInline || container ? 'markdown' : 'literal',
		joins: descriptor ? JOINS[descriptor.mergeRole] : 'never',
		textPosition:
			descriptor?.blockFocus === 'whole-block' ? 'never' : (descriptor?.textPosition ?? 'always')
	};
}

/** Whether a block of this kind has a caret position now; `sourceShows` says whether a block drawn
 *  as a picture of its source is showing that source. */
export function hasTextPosition(kind: string, sourceShows: boolean): boolean {
	const { textPosition } = blockFacts(kind);
	return textPosition === 'always' || (textPosition === 'while-source-shows' && sourceShows);
}

// ── Internals ────────────────────────────────────────────────────────────────

// Shapes only these built-ins write, so no registration declares them.
const BUILT_IN_LINES: Partial<Record<string, BlockFacts['lines']>> = {
	list: 'items',
	table: 'rows',
	tableRow: 'cells'
};

const JOINS: Record<MergeRole, BlockFacts['joins']> = {
	prose: 'text',
	'prose-absorber': 'text-keeping-type',
	container: 'into-deepest',
	'self-merge': 'same-type',
	'not-mergeable': 'never'
};

function linesOf(kind: string, descriptor: BlockKindDescriptor | undefined): BlockFacts['lines'] {
	const builtIn = BUILT_IN_LINES[kind];
	if (builtIn) return builtIn;
	if (descriptor?.bodyWrap?.beforeCloserLine) return 'fenced';
	return descriptor?.lines?.marker ?? 'none';
}

function mergesOf(
	kind: string,
	descriptor: BlockKindDescriptor | undefined,
	lines: BlockFacts['lines']
): BlockFacts['merges'] {
	// Every `:::` container's name is its identity, and the colon grammar stores it as `name`.
	const declared =
		descriptor?.merges ?? (isDirectiveContainerKind(kind as AnyBlockKind) ? { key: 'name' } : null);
	if (!declared) return { into: [], onMismatch: 'nest' };
	// A list of the other kind splits the list it lands in rather than nesting.
	const onMismatch = lines === 'items' ? 'break-out' : 'nest';
	return { into: [kind], ...(declared.key === undefined ? {} : { key: declared.key }), onMismatch };
}

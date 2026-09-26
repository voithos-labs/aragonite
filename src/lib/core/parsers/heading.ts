// ATX headings only. Setext (`===` / `---` underline) lives in paragraph.ts
// because it emerges from paragraph continuation.

import type { AnyBlockKind } from '../nodes';

export function matchHeading(text: string): { level: number } | null {
	const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
	return m ? { level: m[1].length } : null;
}

/**
 * A heading whose bytes are its hashes alone: CommonMark's empty heading, and the state a line
 * passes through on the way to `#tag`. The parse keeps it a heading; what it shows as is
 * {@link shownKind}'s answer.
 */
export function isBareHeadingOpener(raw: string): boolean {
	return /^ {0,3}#{1,6}(?:\r?\n)?$/.test(raw);
}

/**
 * The kind a block shows as: its own, except that a bare `#` keeps the paragraph's type until the
 * space after the hashes lands, so a line on its way to `#tag` never flashes to heading size.
 * Its paint, its accessible name and the kind cue all read this.
 */
export function shownKind(node: { kind: AnyBlockKind; raw: string }): AnyBlockKind {
	return node.kind === 'heading' && isBareHeadingOpener(node.raw) ? 'paragraph' : node.kind;
}

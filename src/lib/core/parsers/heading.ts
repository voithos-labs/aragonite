// ATX headings only. Setext (`===` / `---` underline) lives in paragraph.ts
// because it emerges from paragraph continuation.

export function matchHeading(text: string): { level: number } | null {
	const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
	return m ? { level: m[1].length } : null;
}

/**
 * A heading whose bytes are its hashes alone: CommonMark's empty heading, and the state a line
 * passes through on the way to `#tag`. The parse keeps it a heading; the paint is the caller's
 * call (`built-in-blocks.ts` keeps the paragraph's type until the space after the hashes lands).
 */
export function isBareHeadingOpener(raw: string): boolean {
	return /^ {0,3}#{1,6}(?:\r?\n)?$/.test(raw);
}

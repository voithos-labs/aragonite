// ATX headings only. Setext (`===` / `---` underline) lives in paragraph.ts
// because it emerges from paragraph continuation.

export function matchHeading(text: string): { level: number } | null {
	const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
	return m ? { level: m[1].length } : null;
}

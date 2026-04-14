/**
 * ATX heading parser. Matches `# `, `## `, … `###### `. Setext headings
 * (the `===` / `---` underline form) emerge from paragraph parsing and
 * live in `paragraph.ts`.
 */

export function matchHeading(text: string): { level: number } | null {
	const m = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
	return m ? { level: m[1].length } : null;
}

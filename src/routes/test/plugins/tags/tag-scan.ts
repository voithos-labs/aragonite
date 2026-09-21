/**
 * In-body `#tag` recognition, the shape limestone's own scanner has: a tag opens at a block's
 * start, after whitespace, or after `(` — never mid-word, so `C#` and a URL fragment stay text.
 * Pure and aragonite-free, so the rules are testable without an editor.
 */

export interface TagSpan {
	start: number;
	end: number;
	/** The name without its `#`. */
	name: string;
}

const TAG_CHAR = /[\p{L}\p{N}_\-/]/u;

/** Whether a `#` at `pos` could open a tag: the position half of {@link recognizeTag}. */
export function isTagOpening(raw: string, pos: number): boolean {
	const prev = pos > 0 ? raw[pos - 1] : '';
	return prev === '' || /\s/.test(prev) || prev === '(';
}

/** Whether these bytes could still be a tag's name, the empty name included. */
export function isTagQuery(query: string): boolean {
	return [...query].every((ch) => TAG_CHAR.test(ch));
}

export function recognizeTag(raw: string, pos: number, end: number): TagSpan | null {
	if (raw[pos] !== '#') return null;
	if (!isTagOpening(raw, pos)) return null;
	let i = pos + 1;
	while (i < end && TAG_CHAR.test(raw[i])) i++;
	let name = raw.slice(pos + 1, i);
	// A trailing `/` is a separator the author has not finished typing, not part of the name.
	while (name.endsWith('/')) name = name.slice(0, -1);
	// An all-digit name is an issue reference or a heading anchor, neither of which is a tag.
	if (!name || /^\d+$/.test(name)) return null;
	return { start: pos, end: pos + 1 + name.length, name };
}

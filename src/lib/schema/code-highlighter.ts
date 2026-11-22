/**
 * What a plugin's `contributes(...).code` answers for fenced code: the tokens of a body and the
 * languages it knows. The editor draws the tokens and offers the languages in the code block's
 * picker; with no such plugin, code paints plain.
 */

/** A run of a code body drawn with `class`, in offsets into the body; runs nest or don't overlap,
 *  and of two over one range the one listed first is drawn outside. */
export interface CodeToken {
	readonly from: number;
	readonly to: number;
	readonly class: string;
}

/** `tokens` as a body of `length` draws them, in drawing order; a token out of order, empty, past the
 *  body or crossing the run around it is dropped. */
export function nestedTokens(
	length: number,
	tokens: readonly CodeToken[]
): { kept: CodeToken[]; dropped: CodeToken[] } {
	const kept: CodeToken[] = [];
	const dropped: CodeToken[] = [];
	// The ends of the runs open around the next token, the body's own first; `at` is drawn up to.
	const open = [length];
	let at = 0;
	for (const token of [...tokens].sort((a, b) => a.from - b.from || b.to - a.to)) {
		while (open.length > 1 && open[open.length - 1] <= token.from) at = Math.max(at, open.pop()!);
		if (token.from < at || token.to <= token.from || token.to > open[open.length - 1]) {
			dropped.push(token);
			continue;
		}
		at = Math.max(at, token.from);
		open.push(token.to);
		kept.push(token);
	}
	return { kept, dropped };
}

/** A language the picker offers: one row under `name`, with `aliases` as search keys. */
export interface CodeLanguage {
	readonly name: string;
	readonly aliases?: readonly string[];
}

/** What a source view paints its code with (`renderSource`'s second argument): `body` drawn in
 *  `language` through the editor's highlighters, its text exactly `body`. */
export interface CodePainter {
	code(body: string, language: string): Node;
}

/** Highlights fenced code in the languages it lists; several plugins may contribute one. */
export interface CodeHighlighter {
	/** `body`'s tokens in `language`, a name `languages` lists; null paints it plain. A promise paints
	 *  it plain until it settles; a throw or a rejection paints it plain and is reported. */
	highlight(
		body: string,
		language: string
	): readonly CodeToken[] | null | Promise<readonly CodeToken[] | null>;
	/** The languages it answers, in the order the picker lists them after the plugins listed before
	 *  it; for each spelling, the first plugin listing it is the one asked. */
	languages(): readonly CodeLanguage[];
}

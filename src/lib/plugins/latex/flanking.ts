// The space test beside a `$` delimiter. The flanking rule reads Unicode whitespace, as
// emphasis does, so a price written `5 $` with a non-breaking space stays prose.
export const isFlankingSpace = (ch: string | undefined): boolean =>
	ch !== undefined && /\s/.test(ch);

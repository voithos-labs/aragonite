/**
 * The rows every spelling menu shows over a misspelled word, whichever place shows them (the
 * right-click menu, the hover card, the selection toolbar's flyout): its suggestions, then "Add to
 * dictionary" where the dictionary keeps words.
 */

const MAX_SUGGESTION_ROWS = 5;

/** What a picked row does; null for the dimmed "No suggestions". */
export type SpellingPick = { replace: string } | { add: true } | null;

export interface SpellingRow {
	label: string;
	pick: SpellingPick;
}

export function spellingRows(suggestions: readonly string[], canAdd: boolean): SpellingRow[] {
	const rows: SpellingRow[] =
		suggestions.length === 0
			? [{ label: 'No suggestions', pick: null }]
			: suggestions
					.slice(0, MAX_SUGGESTION_ROWS)
					.map((word) => ({ label: word, pick: { replace: word } }));
	if (canAdd) rows.push({ label: 'Add to dictionary', pick: { add: true } });
	return rows;
}

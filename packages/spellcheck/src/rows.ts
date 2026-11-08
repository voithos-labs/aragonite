/**
 * The rows every spelling menu shows over a misspelled word, whichever place shows them (the
 * right-click menu, the hover menu, the selection toolbar's flyout): its suggestions, then "Add to
 * dictionary" where the dictionary keeps words.
 */

/** What a screen reader calls the hover menu. */
export const SPELLING_MENU_LABEL = 'Spelling suggestions';
const MAX_SUGGESTION_ROWS = 5;
const SUGGESTION = 'spell.';
const ADD = 'spell.add';

export interface SpellingRow {
	id: string;
	label: string;
	disabled?: true;
}

/** What a picked row asks for. */
export type SpellingPick = { replace: string } | { add: true };

/** `suggestions` is null while they're on their way. */
export function spellingRows(
	suggestions: readonly string[] | null,
	canAdd: boolean
): SpellingRow[] {
	const rows: SpellingRow[] =
		suggestions === null
			? [{ id: 'spell.pending', label: 'Finding suggestions…', disabled: true }]
			: suggestions.length === 0
				? [{ id: 'spell.none', label: 'No suggestions', disabled: true }]
				: suggestions
						.slice(0, MAX_SUGGESTION_ROWS)
						.map((word, i) => ({ id: `${SUGGESTION}${i}`, label: word }));
	if (canAdd) rows.push({ id: ADD, label: 'Add to dictionary' });
	return rows;
}

/** The pick a row's id stands for, read against the suggestions it was drawn from; null for a
 *  dimmed row or one that isn't a spelling row. */
export function spellingPick(
	id: string,
	suggestions: readonly string[] | null
): SpellingPick | null {
	if (id === ADD) return { add: true };
	if (!id.startsWith(SUGGESTION)) return null;
	const word = suggestions?.[Number(id.slice(SUGGESTION.length))];
	return word === undefined ? null : { replace: word };
}

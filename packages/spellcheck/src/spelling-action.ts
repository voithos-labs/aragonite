/**
 * The Spelling rows as a selection action: over the misspelled word at a right-click's caret, or a
 * selection of exactly that word, leading the right-click menu and giving the toolbar its row.
 */

import type { ActionRow, Captured, SelectionAction } from '@voithos-labs/aragonite/plugin';
import { wordAt, writeWord } from './misspelling';
import { spellingRows, type SpellingRow } from './rows';
import type { Verdicts } from './verdicts';

// Lucide's spell-check glyph, stroked like the editor's own menu icons.
const ICON = {
	svg: '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 16 6-12 6 12M8 12h8M16 20l2 2 4-4"/></svg>'
};

export function spellingAction(verdicts: Verdicts): SelectionAction {
	function asRow(row: SpellingRow, captured: Captured): ActionRow {
		const { pick } = row;
		return {
			label: row.label,
			disabled: pick === null,
			run(draft) {
				if (pick && 'replace' in pick) return writeWord(draft, captured.range, pick.replace);
				// Not awaited, so the menu closes now; a host's slow save keeps the word meanwhile.
				if (pick) void verdicts.add(captured.text);
			}
		};
	}
	const rowsFor = (suggestions: readonly string[], captured: Captured): ActionRow[] =>
		spellingRows(suggestions, verdicts.canAdd).map((row) => asRow(row, captured));

	return {
		label: 'Spelling',
		icon: ICON,
		lead: true,
		capture(editor, { from, to }) {
			const word = wordAt(editor, from);
			if (!word || (from !== to && (word.from !== from || word.to !== to))) return null;
			verdicts.ask([word.word]);
			return verdicts.misspelled(word.word) ? { from: word.from, to: word.to } : null;
		},
		rows(captured) {
			const held = verdicts.peekSuggestions(captured.text);
			return held
				? rowsFor(held, captured)
				: verdicts.suggestions(captured.text).then((list) => rowsFor(list, captured));
		}
	};
}

/**
 * Consumer-guide chord coherence (drift guard). Every chord in consumer-guide.md
 * § Keyboard shortcuts must resolve in the code that actually dispatches it, so
 * the hand-listed table can't silently drift from the bindings. Chords route
 * through three owners, and each documented family is validated against its own:
 *
 *   - Editing / Block reorder → the per-kind + global keymap registry
 *     (`resolveBinding`, which falls through to the global table).
 *   - Tables → the cell keydown plan. The structural table chords live as
 *     predicates in `cell-keydown-plan.ts`, not the keymap (the single-source
 *     gap tracked in docs/issues.md); a chord "resolves" when the plan is
 *     non-native for a synthesized key event.
 *   - Find / replace → literal presence in the search components
 *     (`Editor.svelte` / `SearchBar.svelte`) plus the reserved Ctrl+F / Ctrl+H
 *     source (`schema/commands.ts`, read by the root handler via
 *     `isReservedUiChord`); these route outside the keymap by design, so an
 *     unknown find chord fails until it's wired.
 *
 * A new documented chord with no dispatch, or a renamed family header, fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import '$lib/schema/built-in-descriptors';
import { resolveBinding } from '$lib/schema/commands';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import { normalizeChord } from '$lib/schema/keybindings';
import {
	cellKeydownPlan,
	type CellKeyInput,
	type CellKeyState
} from '$lib/components/blocks/table/cell-keydown-plan';
import { readEditorFile } from './scan-source';

// ── Doc parsing ─────────────────────────────────────────────────────────────
// Map the display key names the doc uses to the event key names the code sees.
const KEY_ALIASES: Record<string, string> = {
	'↑': 'ArrowUp',
	'↓': 'ArrowDown',
	'←': 'ArrowLeft',
	'→': 'ArrowRight',
	Esc: 'Escape'
};

function normalizeDocChord(raw: string): string {
	const parts = raw.split('+');
	const key = parts.pop() ?? '';
	return normalizeChord([...parts, KEY_ALIASES[key] ?? key].join('+'));
}

// Family header (`**Editing**`) → normalized chords under it. Chord cells wrap
// every chord in backticks; parenthetical prose (`(0 clears…)`, `(in the find
// field)`) is stripped first so its incidental backtick tokens (`#`, `######`)
// aren't mistaken for chords.
function parseDocumentedChords(): Map<string, string[]> {
	const guide = readFileSync(path.resolve('docs/guide/consumer-guide.md'), 'utf8');
	const section = guide.split('## Keyboard shortcuts')[1]?.split('\n## ')[0] ?? '';

	const byFamily = new Map<string, string[]>();
	let family: string | null = null;
	for (const line of section.split('\n')) {
		if (!line.trimStart().startsWith('|')) continue;
		const cells = line.split('|').map((c) => c.trim());
		const action = cells[1] ?? '';
		const chordCell = cells[2] ?? '';
		if (action === 'Action' || /^:?-+:?$/.test(action)) continue;
		if (chordCell === '' && action.startsWith('**')) {
			family = action.replaceAll('*', '').trim();
			byFamily.set(family, []);
			continue;
		}
		if (chordCell === '' || family === null) continue;
		const tokens = chordCell.replace(/\([^)]*\)/g, '').match(/`([^`]+)`/g) ?? [];
		for (const tok of tokens) byFamily.get(family)!.push(normalizeDocChord(tok.slice(1, -1)));
	}
	for (const [f, chords] of byFamily) byFamily.set(f, [...new Set(chords)]);
	return byFamily;
}

// ── Per-family resolvers ─────────────────────────────────────────────────────
function keymapResolves(chord: string): boolean {
	return getAllRegisteredKinds().some((kind) => resolveBinding(chord, kind) !== null);
}

// A mid-grid cell with room on every side, so a nav chord lands on a real
// neighbor (a `focus-cell` plan) rather than exiting the table.
const CENTRAL_CELL: CellKeyState = {
	rowIdx: 1,
	colIdx: 1,
	columnCount: 3,
	rowCount: 3,
	offset: 1,
	textLen: 2,
	collapsed: true,
	selectAllCount: 0
};

function toCellInput(chord: string): CellKeyInput {
	const parts = chord.split('+');
	const key = parts.pop() ?? '';
	return {
		key,
		ctrlOrMeta: parts.includes('Mod'),
		shiftKey: parts.includes('Shift'),
		altKey: parts.includes('Alt')
	};
}

function cellPlanResolves(chord: string): boolean {
	return cellKeydownPlan(toCellInput(chord), CENTRAL_CELL).kind !== 'native';
}

// Find/replace chords route through the search components; the reserved Ctrl+F /
// Ctrl+H pair single-sources from schema/commands.ts (RESERVED_UI_CHORDS), which
// the root handler reads via isReservedUiChord. The token each chord must show in
// that (comment-stripped) source; an undocumented-in-code chord has no entry and fails.
const SEARCH_SOURCE = [
	readEditorFile('components/Editor.svelte').code,
	readEditorFile('components/SearchBar.svelte').code,
	readEditorFile('schema/commands.ts').code
].join('\n');
const SEARCH_CHORD_TOKENS: Record<string, string[]> = {
	'Mod+F': ["'Mod+F'"],
	'Mod+H': ["'Mod+H'"],
	Escape: ["'Escape'"],
	Enter: ["'Enter'"],
	'Shift+Enter': ["'Enter'", 'shiftKey']
};

function searchResolves(chord: string): boolean {
	const tokens = SEARCH_CHORD_TOKENS[chord];
	return tokens !== undefined && tokens.every((t) => SEARCH_SOURCE.includes(t));
}

const RESOLVERS: Record<string, (chord: string) => boolean> = {
	Editing: keymapResolves,
	'Block reorder': keymapResolves,
	Tables: cellPlanResolves,
	'Find / replace': searchResolves
};

// ── Tests ─────────────────────────────────────────────────────────────────
const documented = parseDocumentedChords();

describe('consumer-guide § Keyboard shortcuts — every documented chord resolves in code', () => {
	for (const [family, chords] of documented) {
		it(`${family}: all chords dispatch`, () => {
			const resolve = RESOLVERS[family];
			expect(resolve, `no resolver for documented family "${family}"`).toBeTypeOf('function');
			const unresolved = chords.filter((c) => !resolve(c));
			expect(unresolved, `${family} chords with no dispatch: ${unresolved.join(', ')}`).toEqual([]);
		});
	}
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// Without these a broken parser (empty families) or a permanently-true resolver
// would let the guards above pass on nothing.

describe('consumer-guide chord coherence — self-tests', () => {
	it('parses every documented family with a representative chord', () => {
		expect([...documented.keys()].sort()).toEqual(
			['Block reorder', 'Editing', 'Find / replace', 'Tables'].sort()
		);
		expect(documented.get('Editing')).toContain('Mod+B');
		expect(documented.get('Block reorder')).toContain('Alt+ArrowUp');
		expect(documented.get('Find / replace')).toContain('Escape');
		expect(documented.get('Tables')).toContain('Mod+Shift+A');
	});

	it('resolvers reject a chord that is dispatched nowhere', () => {
		expect(keymapResolves('Mod+Q')).toBe(false);
		expect(cellPlanResolves('Mod+Q')).toBe(false);
		expect(searchResolves('Mod+Q')).toBe(false);
	});

	it('normalizes the doc display names the code never sees', () => {
		expect(normalizeDocChord('Alt+↑')).toBe('Alt+ArrowUp');
		expect(normalizeDocChord('Esc')).toBe('Escape');
		expect(normalizeDocChord('Mod+Shift+A')).toBe('Mod+Shift+A');
	});
});

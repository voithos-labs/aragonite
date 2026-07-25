/**
 * Consumer-guide chord coherence (drift guard). Every chord in consumer-guide.md
 * § Keyboard shortcuts must resolve in the code that actually dispatches it, so
 * the hand-listed table can't silently drift from the bindings. Chords route
 * through several owners, and each documented family is validated against its own:
 *
 *   - Editing / Block reorder → the per-kind + global keymap registry
 *     (`resolveBinding`, which falls through to the global table).
 *   - Tables → the cell keydown plan. The structural table chords live as
 *     predicates in `cell-keydown-plan.ts`, not the keymap (the single-source
 *     gap tracked in docs/issues.md); a chord "resolves" when the plan is
 *     non-native for a synthesized key event.
 *   - Find / replace → literal presence in the two dispatch sites
 *     (`editor-root-keydown.ts` / `SearchBar.svelte`) plus the reserved Ctrl+F /
 *     Ctrl+H source (`schema/commands.ts`, read by the root handler via
 *     `isReservedUiChord`); these route outside the keymap by design, so an
 *     unknown find chord fails until it's wired.
 *   - Clipboard → the whole-block key tail (`container-block-component.ts`) and
 *     the text block's clipboard seam (`text-clipboard.ts`). A keydown carries no
 *     ClipboardEvent, so Mod+C/Mod+X route outside the keymap: the tail writes a
 *     viewport-focused block's own Markdown, and the same chords act on a selected
 *     inline widget through the seam. Each chord must show its dispatch branch in
 *     both owners' source, so deleting either drops the row it documents.
 *
 * A new documented chord with no dispatch, or a renamed family header, fails here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import { resolveBinding } from '$lib/schema/commands';
import { getAllRegisteredKinds } from '$lib/schema/block-kind-descriptor';
import { normalizeChord } from '$lib/schema/keybindings';
import {
	cellKeydownPlan,
	type CellKeyInput,
	type CellKeyState
} from '$lib/components/blocks/table/cell-keydown-plan';
import { readEditorFile } from './scan-source';

registerBuiltInDescriptors();

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
	readEditorFile('components/editor-root-keydown.ts').code,
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

// Whole-block copy/cut routes outside the keymap: a keydown carries no
// ClipboardEvent, so the whole-block key tail writes the focused block's own
// Markdown on Mod+C/Mod+X, and the text block's clipboard seam runs the same
// chords over a selected inline widget. Each chord names one token from the tail
// branch and one from the widget branch; requiring both means deleting either
// dispatch fails the row it documents (the tail token carries the load-bearing
// teeth). Tokens are code shapes, so they survive comment-stripping.
const CLIPBOARD_SOURCE = [
	readEditorFile('editor-actions/container-block-component.ts').code,
	readEditorFile('components/blocks/text/text-clipboard.ts').code
].join('\n');
const CLIPBOARD_CHORD_TOKENS: Record<string, string[]> = {
	'Mod+C': ['(e.ctrlKey || e.metaKey)', "e.key === 'c'", 'widget.inline.start'],
	'Mod+X': [
		'(e.ctrlKey || e.metaKey)',
		"e.key === 'x'",
		'deps.node.raw.slice(inline.start, inline.end)'
	]
};

function clipboardResolves(chord: string): boolean {
	const tokens = CLIPBOARD_CHORD_TOKENS[chord];
	return tokens !== undefined && tokens.every((t) => CLIPBOARD_SOURCE.includes(t));
}

const RESOLVERS: Record<string, (chord: string) => boolean> = {
	Editing: keymapResolves,
	'Block reorder': keymapResolves,
	Tables: cellPlanResolves,
	'Find / replace': searchResolves,
	Clipboard: clipboardResolves
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
			['Block reorder', 'Clipboard', 'Editing', 'Find / replace', 'Tables'].sort()
		);
		expect(documented.get('Editing')).toContain('Mod+B');
		expect(documented.get('Block reorder')).toContain('Alt+ArrowUp');
		expect(documented.get('Find / replace')).toContain('Escape');
		expect(documented.get('Tables')).toContain('Mod+Shift+A');
		expect(documented.get('Clipboard')).toContain('Mod+C');
	});

	it('resolvers reject a chord that is dispatched nowhere', () => {
		expect(keymapResolves('Mod+Q')).toBe(false);
		expect(cellPlanResolves('Mod+Q')).toBe(false);
		expect(searchResolves('Mod+Q')).toBe(false);
		expect(clipboardResolves('Mod+Q')).toBe(false);
	});

	it('normalizes the doc display names the code never sees', () => {
		expect(normalizeDocChord('Alt+↑')).toBe('Alt+ArrowUp');
		expect(normalizeDocChord('Esc')).toBe('Escape');
		expect(normalizeDocChord('Mod+Shift+A')).toBe('Mod+Shift+A');
	});
});

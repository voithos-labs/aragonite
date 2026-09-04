/**
 * Consumer-guide chord coherence, both directions: every row of § Keyboard shortcuts resolves to
 * the command it claims, on the kind whose surface the family names, and every chord the code
 * binds or claims has a row. Chords route through several owners: Editing / Block reorder /
 * Tables against the keymap registry; Find / replace against literal presence in the two search
 * dispatch sites plus the reserved-chord source; and Clipboard against BOTH the whole-block key
 * tail and the text block's clipboard seam, since a keydown carries no ClipboardEvent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AnyBlockKind } from '$lib/core/nodes';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import { resolveBinding, type CommandId } from '$lib/schema/commands';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { normalizeChord } from '$lib/schema/keybindings';
import { HARDCODED_CHORD_SITES } from '$lib/schema/reserved-chords';
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

/** A digit range (`Mod+0`–`Mod+6`) names every chord between its ends, not just the two. */
function expandDigitRange(from: string, to: string): string[] {
	const shape = /^(.*?)(\d)$/;
	const start = shape.exec(from);
	const end = shape.exec(to);
	if (!start || !end || start[1] !== end[1]) return [from, to];
	const chords: string[] = [];
	for (let digit = Number(start[2]); digit <= Number(end[2]); digit++) {
		chords.push(`${start[1]}${digit}`);
	}
	return chords;
}

export interface DocRow {
	family: string;
	action: string;
	chords: string[];
}

/**
 * The section's rows, family header carried down. Parenthetical prose is stripped first so its
 * incidental backtick tokens aren't mistaken for chords; an escaped pipe is table content, not a
 * cell boundary, so the row spelling a header out survives the split.
 */
export function parseRows(section: string): DocRow[] {
	const rows: DocRow[] = [];
	let family: string | null = null;
	for (const line of section.split('\n')) {
		if (!line.trimStart().startsWith('|')) continue;
		const cells = line.split(/(?<!\\)\|/).map((cell) => cell.trim());
		const action = cells[1] ?? '';
		const chordCell = cells[2] ?? '';
		if (action === 'Action' || /^:?-+:?$/.test(action)) continue;
		if (chordCell === '' && action.startsWith('**')) {
			family = action.replaceAll('*', '').trim();
			continue;
		}
		if (chordCell === '' || family === null) continue;
		const tokens = (chordCell.replace(/\([^)]*\)/g, '').match(/`([^`]+)`/g) ?? []).map((token) =>
			normalizeDocChord(token.slice(1, -1))
		);
		const ranged = /`[^`]+`\s*[–-]\s*`[^`]+`/.test(chordCell)
			? expandDigitRange(tokens[0], tokens[1])
			: tokens;
		rows.push({ family, action, chords: [...new Set(ranged)] });
	}
	return rows;
}

function shortcutSection(): string {
	const guide = readFileSync(path.resolve('docs/guide/consumer-guide.md'), 'utf8');
	return guide.split('## Keyboard shortcuts')[1]?.split('\n## ')[0] ?? '';
}

// ── What each row targets ───────────────────────────────────────────────────

/**
 * The command ids a row's chords must resolve to, and the kind whose surface holds the caret when
 * they do. The kind is load-bearing: `Tab` is three different commands across three rows, and a
 * row that resolved on any kind would say nothing about which one it documents.
 */
const ROW_TARGETS: Record<string, { kind: AnyBlockKind; commands: CommandId[] }> = {
	'Bold (toggle strong)': { kind: 'paragraph', commands: ['format.toggleStrong'] },
	'Italic (toggle emphasis)': { kind: 'paragraph', commands: ['format.toggleEmphasis'] },
	Strikethrough: { kind: 'paragraph', commands: ['format.toggleStrikethrough'] },
	'Inline code': { kind: 'paragraph', commands: ['format.toggleCode'] },
	"Edit a link's URL (live mode)": { kind: 'paragraph', commands: ['link.openCard'] },
	'Cycle heading level': { kind: 'paragraph', commands: ['heading.cycle'] },
	'Split a block': { kind: 'paragraph', commands: ['block.split'] },
	'Hard line break': { kind: 'paragraph', commands: ['block.hardBreak'] },
	'Merge into the block before / after': {
		kind: 'paragraph',
		commands: ['block.mergePrev', 'block.mergeNext']
	},
	'Indent / outdent a list item': {
		kind: 'listItem',
		commands: ['list.indent', 'list.unindent']
	},
	'Indent / dedent a code line': {
		kind: 'fencedCode',
		commands: ['code.indent', 'code.dedent']
	},
	'Insert a tab in prose': { kind: 'paragraph', commands: ['block.insertTab'] },
	Undo: { kind: 'paragraph', commands: ['history.undo'] },
	Redo: { kind: 'paragraph', commands: ['history.redo'] },
	'Move block up / down': { kind: 'paragraph', commands: ['block.moveUp', 'block.moveDown'] },
	'Move between cells': { kind: 'tableCell', commands: ['cell.tab', 'cell.shiftTab'] },
	'Next row (or add one)': { kind: 'tableCell', commands: ['cell.enter'] },
	'Insert row below / above': {
		kind: 'tableCell',
		commands: ['table.insertRowBelow', 'table.insertRowAbove']
	},
	'Insert column right / left': {
		kind: 'tableCell',
		commands: ['table.insertColumnRight', 'table.insertColumnLeft']
	},
	'Delete row': { kind: 'tableCell', commands: ['table.deleteRow'] },
	'Delete column': { kind: 'tableCell', commands: ['table.deleteColumn'] },
	'Move row up / down': {
		kind: 'tableCell',
		commands: ['table.moveRowUp', 'table.moveRowDown']
	},
	'Move column left / right': {
		kind: 'tableCell',
		commands: ['table.moveColumnLeft', 'table.moveColumnRight']
	},
	'Move the whole table up / down': {
		kind: 'tableCell',
		commands: ['block.moveUp', 'block.moveDown']
	},
	'Cycle column alignment': { kind: 'tableCell', commands: ['table.cycleAlignment'] },
	// The header-row completion rides the paragraph's own Enter, which is why it is a row here.
	'Create a table': { kind: 'paragraph', commands: ['block.split'] }
};

const KEYMAP_FAMILIES = ['Editing', 'Block reorder', 'Tables'];

// ── Dispatch sites outside the keymap ───────────────────────────────────────

// Find/replace routes through the search components, and the reserved Ctrl+F / Ctrl+H pair
// single-sources from schema/commands.ts. Each value is the token the chord must show in that
// (comment-stripped) source.
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

// Each chord names one token from the tail branch and one from the widget branch, so deleting
// either dispatch fails the row it documents. Tokens are code shapes, so they survive stripping.
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

const TOKEN_RESOLVERS: Record<string, { source: string; tokens: Record<string, string[]> }> = {
	'Find / replace': { source: SEARCH_SOURCE, tokens: SEARCH_CHORD_TOKENS },
	Clipboard: { source: CLIPBOARD_SOURCE, tokens: CLIPBOARD_CHORD_TOKENS }
};

export function tokensResolve(family: string, chord: string): boolean {
	const resolver = TOKEN_RESOLVERS[family];
	const tokens = resolver?.tokens[chord];
	return tokens !== undefined && tokens.every((token) => resolver.source.includes(token));
}

// ── What the code claims ────────────────────────────────────────────────────

function boundChords(): Map<string, AnyBlockKind[]> {
	const bound = new Map<string, AnyBlockKind[]>();
	for (const kind of getAllRegisteredKinds()) {
		for (const binding of tryGetBlockKindDescriptor(kind)?.keymap ?? []) {
			bound.set(binding.chord, [...(bound.get(binding.chord) ?? []), kind]);
		}
	}
	return bound;
}

/**
 * Chords the code claims that the table deliberately has no row for, each with the guide's own
 * reason. A stale entry is a failure of its own, so a chord that stops being claimed shows up.
 */
const UNLISTED_BY_DESIGN: Record<string, string> = {
	'Shift+F10': 'the Tables preamble documents it in prose as the keyboard route to the cell menu',
	'Mod+A': 'selection: the section says the escalation routes outside the keymap and is unlisted',
	'Mod+Shift+Home': 'selection: routes outside the keymap, so it is not rebindable or listed',
	'Mod+Shift+End': 'selection: routes outside the keymap, so it is not rebindable or listed',
	'Shift+ArrowUp': 'Shift+Arrow selection, named as a family in the section preamble',
	'Shift+ArrowDown': 'Shift+Arrow selection, named as a family in the section preamble',
	'Shift+ArrowLeft': 'Shift+Arrow selection, named as a family in the section preamble',
	'Shift+ArrowRight': 'Shift+Arrow selection, named as a family in the section preamble'
};

// ── The gate ────────────────────────────────────────────────────────────────

const rows = parseRows(shortcutSection());
const documented = new Set(rows.flatMap((row) => row.chords));
const keymapRows = rows.filter((row) => KEYMAP_FAMILIES.includes(row.family));

describe('consumer-guide § Keyboard shortcuts → code', () => {
	it.each(keymapRows)('$family — $action resolves to the command it names', (row) => {
		const target = ROW_TARGETS[row.action];
		expect(target, `no ROW_TARGETS entry for "${row.action}"`).toBeDefined();
		const resolved = row.chords.map((chord) => resolveBinding(chord, target.kind)?.command ?? null);
		expect(
			[...new Set(resolved)].sort(),
			`on ${target.kind} these chords run something else than the row claims: ${row.chords.join(', ')}`
		).toEqual([...new Set(target.commands)].sort());
	});

	it.each(rows.filter((row) => row.family in TOKEN_RESOLVERS))(
		'$family — $action reaches its dispatch site',
		(row) => {
			const unresolved = row.chords.filter((chord) => !tokensResolve(row.family, chord));
			expect(unresolved, `no dispatch for: ${unresolved.join(', ')}`).toEqual([]);
		}
	);

	it('holds a target for every keymap row and no target for a row that went away', () => {
		expect(Object.keys(ROW_TARGETS).sort()).toEqual(keymapRows.map((row) => row.action).sort());
	});
});

describe('code → consumer-guide § Keyboard shortcuts', () => {
	it('every chord a built-in keymap binds has a row', () => {
		const unlisted = [...boundChords()]
			.filter(([chord]) => !documented.has(chord))
			.map(([chord, kinds]) => `${chord} (${kinds.join(', ')})`);
		expect(
			unlisted,
			`bound but undocumented — give each a row, since the table is the human reference: ${unlisted.join(', ')}`
		).toEqual([]);
	});

	it('every chord a keydown branch claims has a row or a recorded reason', () => {
		const unlisted = HARDCODED_CHORD_SITES.flatMap((site) =>
			site.chords
				.filter((chord) => !documented.has(chord) && !(chord in UNLISTED_BY_DESIGN))
				.map((chord) => `${chord} (${site.file})`)
		);
		expect(
			unlisted,
			`claimed but undocumented — add a row, or an UNLISTED_BY_DESIGN entry saying where the guide covers it: ${unlisted.join(', ')}`
		).toEqual([]);
	});

	it('holds no UNLISTED_BY_DESIGN entry nothing claims any more', () => {
		const claimed = new Set(HARDCODED_CHORD_SITES.flatMap((site) => site.chords));
		const stale = Object.keys(UNLISTED_BY_DESIGN).filter(
			(chord) => !claimed.has(chord) || documented.has(chord)
		);
		expect(stale, `drop these exemptions: ${stale.join(', ')}`).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A parser that finds no rows, or a resolver that says yes to everything, lets every assertion
// above pass on nothing.

describe('consumer-guide chord coherence — self-tests', () => {
	it('parses every family, and the rows a naive cell split loses', () => {
		expect([...new Set(rows.map((row) => row.family))].sort()).toEqual(
			['Block reorder', 'Clipboard', 'Editing', 'Find / replace', 'Tables'].sort()
		);
		expect(rows.length).toBeGreaterThan(25);
		// Its chord cell spells a header row out, escaped pipes and all.
		expect(rows.find((row) => row.action === 'Create a table')?.chords).toEqual(['Enter']);
	});

	it('expands a digit range instead of reading only its ends', () => {
		expect(rows.find((row) => row.action === 'Cycle heading level')?.chords).toEqual([
			'Mod+0',
			'Mod+1',
			'Mod+2',
			'Mod+3',
			'Mod+4',
			'Mod+5',
			'Mod+6'
		]);
		expect(expandDigitRange('Mod+B', 'Mod+E')).toEqual(['Mod+B', 'Mod+E']);
	});

	it('normalizes the doc display names the code never sees', () => {
		expect(normalizeDocChord('Alt+↑')).toBe('Alt+ArrowUp');
		expect(normalizeDocChord('Esc')).toBe('Escape');
		expect(normalizeDocChord('Mod+Shift+A')).toBe('Mod+Shift+A');
	});

	it('reads a kind-scoped binding, so one chord is three commands across three rows', () => {
		expect(resolveBinding('Tab', 'listItem')?.command).toBe('list.indent');
		expect(resolveBinding('Tab', 'fencedCode')?.command).toBe('code.indent');
		expect(resolveBinding('Tab', 'paragraph')?.command).toBe('block.insertTab');
		expect(resolveBinding('Mod+Q', 'paragraph')).toBeNull();
	});

	it('finds a non-empty claim set on both code axes', () => {
		expect(boundChords().size).toBeGreaterThan(20);
		expect(HARDCODED_CHORD_SITES.flatMap((site) => site.chords).length).toBeGreaterThan(10);
	});

	it('rejects a chord that is dispatched nowhere', () => {
		expect(tokensResolve('Find / replace', 'Mod+Q')).toBe(false);
		expect(tokensResolve('Clipboard', 'Mod+Q')).toBe(false);
		expect(tokensResolve('Editing', 'Mod+B')).toBe(false);
	});
});

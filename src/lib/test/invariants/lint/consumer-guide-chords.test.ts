/**
 * Consumer-guide chord coherence, both directions: every row of § Keyboard shortcuts resolves to
 * the command it claims, on the kind whose surface the family names, and every chord the code
 * binds or claims has its own row. Keymap families resolve against the registry, the rest against
 * literal tokens in their dispatch sites; the reverse sweep matches a chord together with the kind
 * or file that owns it, so a chord with two meanings needs a row for each.
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
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
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
 * they do. The kind matters: `Tab` is three different commands across three rows, and a
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
	'Check / uncheck a task item': { kind: 'listItem', commands: ['list.toggleTask'] },
	'Indent / dedent a code line': {
		kind: 'fencedCode',
		commands: ['code.indent', 'code.dedent']
	},
	// The typed closer the row's prose names is no chord, so only Enter resolves here.
	'Leave a code block': { kind: 'fencedCode', commands: ['code.newline'] },
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

const IMAGE_RESIZE = "e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')";

const TOKEN_RESOLVERS: Record<string, { source: string; tokens: Record<string, string[]> }> = {
	'Find / replace': { source: SEARCH_SOURCE, tokens: SEARCH_CHORD_TOKENS },
	Clipboard: { source: CLIPBOARD_SOURCE, tokens: CLIPBOARD_CHORD_TOKENS },
	Images: {
		source: readEditorFile('components/image/image-widget-editing.ts').code,
		tokens: { 'Shift+ArrowLeft': [IMAGE_RESIZE], 'Shift+ArrowRight': [IMAGE_RESIZE] }
	},
	'Mermaid diagrams': {
		source: readEditorFile('plugins/mermaid/MermaidBlock.svelte').code,
		tokens: { 'Mod+Enter': ["e.key === 'Enter' && (e.ctrlKey || e.metaKey)", 'commitEdit(true)'] }
	}
};

export function tokensResolve(family: string, chord: string): boolean {
	const resolver = TOKEN_RESOLVERS[family];
	const tokens = resolver?.tokens[chord];
	return tokens !== undefined && tokens.every((token) => resolver.source.includes(token));
}

// ── What the code claims ────────────────────────────────────────────────────

/**
 * A chord and its owner: the block kind whose keymap binds it, or the `src/lib` file whose keydown
 * branch claims it. One chord can mean different things to different owners (`Mod+Enter` checks
 * a task item and inserts a table row), so the reverse sweep matches a claim, never a bare chord.
 */
type ClaimKey = `${string} @ ${string}`;

const claimKey = (chord: string, owner: string): ClaimKey => `${chord} @ ${owner}`;

interface BoundClaim {
	chord: string;
	kind: AnyBlockKind;
	command: string;
}

function boundClaims(): BoundClaim[] {
	return getAllRegisteredKinds().flatMap((kind) =>
		(tryGetBlockKindDescriptor(kind)?.keymap ?? []).map(({ chord, command }) => ({
			chord,
			kind,
			command
		}))
	);
}

const hardcodedClaims = HARDCODED_CHORD_SITES.flatMap((site) =>
	site.chords.map((chord) => claimKey(chord, site.file))
);

/** Whether some row lists `chord` for `command`: the row's chord cell and its target must agree. */
export function rowsDocument(docRows: DocRow[], chord: string, command: string): boolean {
	return docRows.some(
		(row) =>
			row.chords.includes(chord) &&
			(ROW_TARGETS[row.action]?.commands as string[] | undefined)?.includes(command) === true
	);
}

/** The row documenting each chord a keydown branch claims, by its Action cell. */
const CLAIM_ROWS: Record<ClaimKey, string> = {
	'Shift+Enter @ components/SearchBar.svelte': 'Next / previous match',
	'Mod+K @ components/link-card/LinkCard.svelte': "Edit a link's URL (live mode)",
	'Shift+Tab @ components/blocks/table/cell-keydown-plan.ts': 'Move between cells',
	'Shift+ArrowLeft @ components/image/image-widget-editing.ts': 'Resize a selected image',
	'Shift+ArrowRight @ components/image/image-widget-editing.ts': 'Resize a selected image',
	'Mod+C @ editor-actions/container-block-component.ts': 'Copy / cut a focused block',
	'Mod+X @ editor-actions/container-block-component.ts': 'Copy / cut a focused block',
	'Alt+ArrowUp @ editor-actions/plugin/container.ts': 'Move block up / down',
	'Alt+ArrowDown @ editor-actions/plugin/container.ts': 'Move block up / down',
	'Mod+Enter @ plugins/mermaid/MermaidBlock.svelte': 'Commit a diagram edit'
};

const SELECTION_PREAMBLE = 'selection: the section preamble names it and says it is unlisted';
const FOCUS_TRAP = 'the backward step of an open popup focus trap, which a bare Tab mirrors';
const SHIFT_ARROWS = ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'];

const unlisted = (chords: string[], owner: string, reason: string) =>
	Object.fromEntries(chords.map((chord) => [claimKey(chord, owner), reason]));

/**
 * Claims the table deliberately has no row for, each with the guide's own reason. A stale entry is
 * a failure of its own, so a claim that goes away, or gains a row, shows up.
 */
const UNLISTED_BY_DESIGN: Record<ClaimKey, string> = {
	...unlisted(
		['Backspace', 'Delete'],
		'fencedCode',
		"a code block's Backspace and Delete only edit its text, which needs no row"
	),
	...unlisted(['Shift+Tab'], 'components/link-card/LinkCard.svelte', FOCUS_TRAP),
	...unlisted(['Shift+Tab'], 'components/blocks/table/TableActionMenu.svelte', FOCUS_TRAP),
	...unlisted(
		['Shift+F10'],
		'components/blocks/table/TableBlock.svelte',
		'the Tables preamble documents it in prose as the keyboard route to the cell menu'
	),
	...unlisted(['Mod+A'], 'components/blocks/table/cell-keydown-plan.ts', SELECTION_PREAMBLE),
	...unlisted(
		['Mod+A', 'Mod+Shift+Home', 'Mod+Shift+End', ...SHIFT_ARROWS],
		'selection/cross-block/keydown.ts',
		SELECTION_PREAMBLE
	),
	...unlisted(SHIFT_ARROWS, 'selection/shared-keydown.ts', SELECTION_PREAMBLE),
	...unlisted(
		['Shift+ArrowUp', 'Shift+ArrowDown'],
		'components/blocks/table/TableCellBlock.svelte',
		SELECTION_PREAMBLE
	),
	...unlisted(
		['Shift+ArrowLeft', 'Shift+ArrowRight'],
		'components/blocks/text/widget-interaction.ts',
		SELECTION_PREAMBLE
	)
};

// ── The gate ────────────────────────────────────────────────────────────────

const rows = parseRows(shortcutSection());
const keymapRows = rows.filter((row) => KEYMAP_FAMILIES.includes(row.family));

describe('consumer-guide § Keyboard shortcuts → code', () => {
	it.each(keymapRows)('$family — $action resolves to the command it names', (row) => {
		const target = ROW_TARGETS[row.action];
		expect(target, `no ROW_TARGETS entry for "${row.action}"`).toBeDefined();
		const resolved = row.chords.map(
			(chord) =>
				resolveBinding(chord, target.kind, undefined, everyInstalledPlugin)?.command ?? null
		);
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
	it('every chord a built-in keymap binds has a row for the command it runs there', () => {
		const undocumented = boundClaims()
			.filter(({ chord, kind }) => !(claimKey(chord, kind) in UNLISTED_BY_DESIGN))
			.filter(({ chord, command }) => !rowsDocument(rows, chord, command))
			.map(({ chord, kind, command }) => `${claimKey(chord, kind)} (${command})`);
		expect(
			undocumented,
			`bound but undocumented: give each a row whose ROW_TARGETS entry names the command: ${undocumented.join(', ')}`
		).toEqual([]);
	});

	it('every chord a keydown branch claims names the row that documents it, or a reason', () => {
		const missing = hardcodedClaims.filter(
			(key) => !(key in CLAIM_ROWS) && !(key in UNLISTED_BY_DESIGN)
		);
		expect(
			missing,
			`claimed but unaccounted for: add a CLAIM_ROWS entry naming its row, or an UNLISTED_BY_DESIGN entry saying where the guide covers it: ${missing.join(', ')}`
		).toEqual([]);
	});

	it.each(Object.entries(CLAIM_ROWS))('%s is documented by the row "%s"', (key, action) => {
		const chord = key.split(' @ ')[0];
		const row = rows.find((candidate) => candidate.action === action);
		expect(row, `no row "${action}" in the guide`).toBeDefined();
		expect(row!.chords, `the row "${action}" does not list ${chord}`).toContain(chord);
	});

	it('holds no entry for a claim that went away or is documented twice', () => {
		const bound = boundClaims();
		const live = new Set<string>([
			...hardcodedClaims,
			...bound.map(({ chord, kind }) => claimKey(chord, kind))
		]);
		const stale = [...Object.keys(CLAIM_ROWS), ...Object.keys(UNLISTED_BY_DESIGN)].filter(
			(key) => !live.has(key)
		);
		const twice = Object.keys(UNLISTED_BY_DESIGN).filter((key) => key in CLAIM_ROWS);
		const alreadyRowed = bound
			.filter(({ chord, kind }) => claimKey(chord, kind) in UNLISTED_BY_DESIGN)
			.filter(({ chord, command }) => rowsDocument(rows, chord, command))
			.map(({ chord, kind }) => claimKey(chord, kind));
		expect(
			[...stale, ...twice, ...alreadyRowed],
			'drop these entries: the claim is gone, or a row already documents it'
		).toEqual([]);
	});
});

// ── Non-vacuity self-tests ───────────────────────────────────────────────────
// A parser that finds no rows, or a resolver that says yes to everything, lets every assertion
// above pass on nothing.

describe('consumer-guide chord coherence: self-tests', () => {
	it('parses every family, and the rows a naive cell split loses', () => {
		expect([...new Set(rows.map((row) => row.family))].sort()).toEqual(
			[
				'Block reorder',
				'Clipboard',
				'Editing',
				'Find / replace',
				'Images',
				'Mermaid diagrams',
				'Tables'
			].sort()
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
		expect(resolveBinding('Tab', 'listItem', undefined, everyInstalledPlugin)?.command).toBe(
			'list.indent'
		);
		expect(resolveBinding('Tab', 'fencedCode', undefined, everyInstalledPlugin)?.command).toBe(
			'code.indent'
		);
		expect(resolveBinding('Tab', 'paragraph', undefined, everyInstalledPlugin)?.command).toBe(
			'block.insertTab'
		);
		expect(resolveBinding('Mod+Q', 'paragraph', undefined, everyInstalledPlugin)).toBeNull();
	});

	it('finds a non-empty claim set on both code axes', () => {
		expect(boundClaims().length).toBeGreaterThan(100);
		expect(hardcodedClaims.length).toBeGreaterThan(10);
	});

	// Miss-analysis: the sweep keyed documented chords by string alone, and no case gave it one chord
	// with two meanings, so a row for either meaning satisfied both.
	it('matches a bound chord to the row for its command, not to any row sharing the chord', () => {
		const tablesOnly = rows.filter((row) => row.action === 'Insert row below / above');
		expect(rowsDocument(tablesOnly, 'Mod+Enter', 'table.insertRowBelow')).toBe(true);
		expect(rowsDocument(tablesOnly, 'Mod+Enter', 'list.toggleTask')).toBe(false);
		expect(rowsDocument(rows, 'Mod+Enter', 'list.toggleTask')).toBe(true);
	});

	it('rejects a chord that is dispatched nowhere', () => {
		expect(tokensResolve('Find / replace', 'Mod+Q')).toBe(false);
		expect(tokensResolve('Clipboard', 'Mod+Q')).toBe(false);
		expect(tokensResolve('Editing', 'Mod+B')).toBe(false);
	});
});

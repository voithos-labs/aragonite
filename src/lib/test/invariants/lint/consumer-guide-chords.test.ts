/**
 * Consumer-guide chord coherence, both directions: every row of § Keyboard shortcuts resolves to
 * the command it claims, and every chord the editor or a bundled plugin binds or claims has its
 * own row. Keymap families resolve against the registry, the rest against literal tokens in their
 * dispatch files; the reverse sweep matches a chord with the kind, keymap, plugin or file that
 * owns it, so a chord with two meanings needs a row for each.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AnyBlockKind } from '$lib/core/nodes';
import { registerBuiltInDescriptors } from '$lib/schema/built-in-descriptors';
import {
	GLOBAL_KEYMAP,
	pluginGlobalBindings,
	resolveBinding,
	type CommandId
} from '$lib/schema/commands';
import {
	getAllRegisteredKinds,
	tryGetBlockKindDescriptor
} from '$lib/schema/block-kind-descriptor';
import { normalizeChord } from '$lib/schema/keybindings';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { HARDCODED_CHORD_SITES } from '$lib/schema/reserved-chords';
import { installPlugins } from '$lib';
import { declaredPluginKind } from '$lib/plugin';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { ADMONITION, ADMONITION_TITLE } from '$lib/plugins/admonitions/kinds';
import { detailsPlugin, DETAILS_SUMMARY } from '$lib/plugins/details';
import { emojiPlugin } from '$lib/plugins/emoji';
import { footnotesPlugin } from '$lib/plugins/footnotes';
import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
import { latexPlugin } from '$lib/plugins/latex';
import { mermaidPlugin, MERMAID } from '$lib/plugins/mermaid';
import { parrotPlugin } from '$lib/plugins/parrot';
import { slashCommandsPlugin, SLASH_COMMANDS_OPEN } from '$lib/plugins/slash-commands';
import { tocPlugin } from '$lib/plugins/toc';
import { readEditorFile } from './scan-source';

// Every bundled plugin, so its kinds' keymaps and its global chords join the sweep. Third-party
// chords stay out: the gate only sees code this repo ships.
const BUNDLED_PLUGINS = [
	admonitionsPlugin(),
	detailsPlugin(),
	emojiPlugin(),
	footnotesPlugin(),
	highlightOccurrencesPlugin(),
	// The sweep reads keymaps only, so no formula is ever rendered.
	latexPlugin({
		renderer: () => {
			throw new Error('the chord sweep renders no math');
		}
	}),
	mermaidPlugin(),
	parrotPlugin(),
	slashCommandsPlugin(),
	tocPlugin()
];
registerBuiltInDescriptors();
installPlugins(BUNDLED_PLUGINS);

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
	'Create a table': { kind: 'paragraph', commands: ['block.split'] },
	// A plugin-global chord resolves on any kind that binds nothing of its own.
	'Open the list at the caret': {
		kind: 'paragraph',
		commands: [SLASH_COMMANDS_OPEN as CommandId]
	},
	'Cycle the admonition kind': {
		kind: declaredPluginKind(ADMONITION),
		commands: ['admonition.cycleKind' as CommandId]
	},
	'Move from the title into the body': {
		kind: declaredPluginKind(ADMONITION_TITLE),
		commands: ['chrome.descendToBody']
	},
	'Move from the summary into the body': {
		kind: declaredPluginKind(DETAILS_SUMMARY),
		commands: ['chrome.descendToBody']
	},
	"Open the diagram's focus view": {
		kind: declaredPluginKind(MERMAID),
		commands: ['mermaid.focus' as CommandId]
	}
};

const KEYMAP_FAMILIES = [
	'Editing',
	'Block reorder',
	'Tables',
	'Slash commands',
	'Admonitions',
	'Details'
];

// ── Dispatch sites outside the keymap ───────────────────────────────────────

// Each family names the files it reads and, per chord, the tokens that chord must show in their
// comment-stripped source. The files are also what makes a keydown claim in one of them rowed.
interface TokenFamily {
	files: string[];
	tokens: Record<string, string[]>;
}

const IMAGE_RESIZE = "e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')";

const TOKEN_FAMILIES: Record<string, TokenFamily> = {
	// The reserved Ctrl+F / Ctrl+H pair single-sources from schema/commands.ts.
	'Find / replace': {
		files: [
			'components/editor-root-keydown.ts',
			'components/SearchBar.svelte',
			'schema/commands.ts'
		],
		tokens: {
			'Mod+F': ["'Mod+F'"],
			'Mod+H': ["'Mod+H'"],
			Escape: ["'Escape'"],
			Enter: ["'Enter'"],
			'Shift+Enter': ["'Enter'", 'shiftKey']
		}
	},
	// One token from the whole-block branch and one from the widget branch, so deleting either
	// dispatch fails the row it documents.
	Clipboard: {
		files: [
			'editor-actions/container-block-component.ts',
			'components/blocks/text/text-clipboard.ts'
		],
		tokens: {
			'Mod+C': ['(e.ctrlKey || e.metaKey)', "e.key === 'c'", 'widget.inline.start'],
			'Mod+X': [
				'(e.ctrlKey || e.metaKey)',
				"e.key === 'x'",
				'deps.node.raw.slice(inline.start, inline.end)'
			]
		}
	},
	Images: {
		files: ['components/image/image-widget-editing.ts'],
		tokens: { 'Shift+ArrowLeft': [IMAGE_RESIZE], 'Shift+ArrowRight': [IMAGE_RESIZE] }
	},
	'Mermaid diagrams': {
		files: ['plugins/mermaid/MermaidBlock.svelte'],
		tokens: { 'Mod+Enter': ["e.key === 'Enter' && (e.ctrlKey || e.metaKey)", 'commitEdit(true)'] }
	}
};

const TOKEN_RESOLVERS = Object.fromEntries(
	Object.entries(TOKEN_FAMILIES).map(([family, { files, tokens }]) => [
		family,
		{ source: files.map((file) => readEditorFile(file).code).join('\n'), tokens }
	])
);

export function tokensResolve(family: string, chord: string): boolean {
	const resolver = TOKEN_RESOLVERS[family];
	const tokens = resolver?.tokens[chord];
	return tokens !== undefined && tokens.every((token) => resolver.source.includes(token));
}

// ── What the code claims ────────────────────────────────────────────────────

/**
 * A chord and its owner: the block kind whose keymap binds it, `global` for the editor-global
 * keymap, a bundled plugin's name for its global command, or the `src/lib` file whose keydown
 * branch claims it. One chord can mean different things to different owners (`Mod+Enter` checks
 * a task item and inserts a table row), so the reverse sweep matches a claim, never a bare chord.
 */
type ClaimKey = `${string} @ ${string}`;

const claimKey = (chord: string, owner: string): ClaimKey => `${chord} @ ${owner}`;

interface BoundClaim {
	chord: string;
	owner: string;
	command: string;
}

function boundClaims(): BoundClaim[] {
	const kindClaims = getAllRegisteredKinds().flatMap((kind) =>
		(tryGetBlockKindDescriptor(kind)?.keymap ?? []).map(({ chord, command }) => ({
			chord,
			owner: kind,
			command
		}))
	);
	const globalClaims = GLOBAL_KEYMAP.map(({ chord, command }) => ({
		chord,
		owner: 'global',
		command
	}));
	const pluginClaims = pluginGlobalBindings(undefined).map(({ chord, command, plugin }) => ({
		chord: normalizeChord(chord),
		owner: plugin ?? 'global',
		command
	}));
	return [...kindClaims, ...globalClaims, ...pluginClaims];
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

/**
 * The row of a token family that documents a keydown claim: one listing its chord, in a family
 * that reads the claiming file. Such a claim needs no hand-written entry.
 */
export function familyRowFor(docRows: DocRow[], key: ClaimKey): string | null {
	const [chord, file] = key.split(' @ ');
	const row = docRows.find(
		(candidate) =>
			TOKEN_FAMILIES[candidate.family]?.files.includes(file) && candidate.chords.includes(chord)
	);
	return row?.action ?? null;
}

/**
 * The row documenting a keydown claim whose row sits in a keymap family, where no file list can
 * derive it. A claim a token family already rows must not appear here.
 */
const CLAIM_ROWS: Record<ClaimKey, string> = {
	'Mod+K @ components/link-card/LinkCard.svelte': "Edit a link's URL (live mode)",
	'Shift+Tab @ components/blocks/table/cell-keydown-plan.ts': 'Move between cells',
	'Alt+ArrowUp @ editor-actions/plugin/container.ts': 'Move block up / down',
	'Alt+ArrowDown @ editor-actions/plugin/container.ts': 'Move block up / down'
};

const SELECTION_PREAMBLE = 'selection: the section preamble names it and says it is unlisted';
const FOCUS_TRAP = 'the backward step of an open popup focus trap, which a bare Tab mirrors';
const SHIFT_ARROWS = ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowLeft', 'Shift+ArrowRight'];

const unlisted = (chords: string[], owner: string, reason: string) =>
	Object.fromEntries(chords.map((chord) => [claimKey(chord, owner), reason]));

/**
 * Claims the table has no row for, each with the guide's own reason. A stale entry is a failure of
 * its own, so a claim that goes away, or gains a row, shows up.
 */
const UNLISTED_BY_DESIGN: Record<ClaimKey, string> = {
	...unlisted(
		['Backspace', 'Delete'],
		'fencedCode',
		'at a fence edge, Backspace and Delete step the caret out of the block instead of merging, which the merge row does not promise'
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
// A token family can hold a keymap row too (Mermaid's `Mod+M`); its ROW_TARGETS entry routes it.
const keymapRows = rows.filter(
	(row) => KEYMAP_FAMILIES.includes(row.family) || row.action in ROW_TARGETS
);

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

	it.each(rows.filter((row) => row.family in TOKEN_RESOLVERS && !(row.action in ROW_TARGETS)))(
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
	it('every chord a keymap binds, built-in or bundled, has a row for the command it runs', () => {
		const undocumented = boundClaims()
			.filter(({ chord, owner }) => !(claimKey(chord, owner) in UNLISTED_BY_DESIGN))
			.filter(({ chord, command }) => !rowsDocument(rows, chord, command))
			.map(({ chord, owner, command }) => `${claimKey(chord, owner)} (${command})`);
		expect(
			undocumented,
			`bound but undocumented: give each a row whose ROW_TARGETS entry names the command: ${undocumented.join(', ')}`
		).toEqual([]);
	});

	it('every chord a keydown branch claims has a row that documents it, or a reason', () => {
		const missing = hardcodedClaims.filter(
			(key) =>
				familyRowFor(rows, key) === null && !(key in CLAIM_ROWS) && !(key in UNLISTED_BY_DESIGN)
		);
		expect(
			missing,
			`claimed but unaccounted for: list the file under its row's TOKEN_FAMILIES entry, add a CLAIM_ROWS entry naming a keymap row, or an UNLISTED_BY_DESIGN entry saying where the guide covers it: ${missing.join(', ')}`
		).toEqual([]);
	});

	// Checks that the row exists and lists the chord, not that it means what the keydown branch runs.
	it.each(Object.entries(CLAIM_ROWS))('%s is documented by the row "%s"', (key, action) => {
		const chord = key.split(' @ ')[0];
		const row = rows.find((candidate) => candidate.action === action);
		expect(row, `no row "${action}" in the guide`).toBeDefined();
		expect(KEYMAP_FAMILIES, `"${action}" is a token family row, which rows it itself`).toContain(
			row!.family
		);
		expect(row!.chords, `the row "${action}" does not list ${chord}`).toContain(chord);
	});

	it('holds no entry for a claim that went away or is documented twice', () => {
		const bound = boundClaims();
		const live = new Set<string>([
			...hardcodedClaims,
			...bound.map(({ chord, owner }) => claimKey(chord, owner))
		]);
		const entries = [...Object.keys(CLAIM_ROWS), ...Object.keys(UNLISTED_BY_DESIGN)] as ClaimKey[];
		const stale = entries.filter((key) => !live.has(key));
		const twice = Object.keys(UNLISTED_BY_DESIGN).filter((key) => key in CLAIM_ROWS);
		const familyRowed = entries.filter((key) => familyRowFor(rows, key) !== null);
		const alreadyRowed = bound
			.filter(({ chord, owner }) => claimKey(chord, owner) in UNLISTED_BY_DESIGN)
			.filter(({ chord, command }) => rowsDocument(rows, chord, command))
			.map(({ chord, owner }) => claimKey(chord, owner));
		expect(
			[...stale, ...twice, ...familyRowed, ...alreadyRowed],
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
				'Admonitions',
				'Block reorder',
				'Clipboard',
				'Details',
				'Editing',
				'Find / replace',
				'Images',
				'Mermaid diagrams',
				'Slash commands',
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

	// Miss-analysis: the sweep read kind keymaps alone, so an undocumented chord in the global
	// keymap or a bundled plugin's global command passed; no case put one there.
	it('sweeps the global keymap, bundled plugin globals and bundled plugin kinds', () => {
		const keys = boundClaims().map(({ chord, owner }) => claimKey(chord, owner));
		expect(keys).toContain('Mod+Z @ global');
		expect(keys).toContain('Mod+/ @ slash-commands');
		expect(keys).toContain('Mod+M @ mermaid');
	});

	// Miss-analysis: a file-owned exemption was checked against the claim list alone, so a row
	// added for its chord left the exemption standing.
	it('rows a keydown claim through the token family that reads its file, and only that one', () => {
		expect(familyRowFor(rows, 'Mod+Enter @ plugins/mermaid/MermaidBlock.svelte')).toBe(
			'Finish editing a diagram'
		);
		expect(familyRowFor(rows, 'Mod+Enter @ components/blocks/table/TableBlock.svelte')).toBeNull();
		expect(familyRowFor(rows, 'Shift+F10 @ components/blocks/table/TableBlock.svelte')).toBeNull();
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

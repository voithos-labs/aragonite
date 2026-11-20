/**
 * Built-in block kinds (descriptor and opener), the table's Enter completer and inline-construct
 * policies. Nothing registers on import: the first grammar read, `core/inline/index.ts` and
 * `components/built-in-blocks.ts` call `registerBuiltInDescriptors()`, since tree-shaking keeps
 * only a called binding.
 */

import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { matchHeading } from '../core/parsers/heading';
import type { KeyBinding } from './keybindings';
import { registerBuiltinBlockKind } from './block-kind-descriptor';
import { BUILT_IN_OPENERS } from '../core/parsers/built-in-openers';
import { QUOTE_LINES } from '../core/parsers/blockquote';
import { LIST_ITEM_LINES } from '../core/parsers/list';
import {
	rebuildListRaw,
	rebuildTableRaw,
	rebuildTableRowRaw,
	tableLastLineChild
} from './container-rebuilders';
import { tableCellWrite } from './table-cell-raw';
import { fencedCodeWrite } from './fenced-code-raw';
import { setextHeadingContentRange, setextHeadingWrite } from './setext-raw';
import { registerInlineConstructPolicy } from './inline-construct-policy';
import { registerAsCore } from './plugin-install';
import { setBuiltInRangeIndent } from './range-indent-forms';
import { registerTableCompleter } from '../core/parsers/table-completion';
import { asCodeSpan } from '../core/inline/scan/code-span';
import {
	containerEstimate,
	proseEstimate,
	singleLineEstimate,
	sourceLinesEstimate
} from './height-estimates';

// ── Content-range helpers ──────────────────────────────────────────────────

// The heading's marker bytes, its `# ` and any closing `#` run, sit outside the editable text.
function headingContentRange(node: NodeView): { start: number; end: number } {
	const heading = matchHeading(node.raw);
	if (!heading) return { start: 0, end: displayLength(node.raw) };
	return { start: heading.contentStart, end: heading.contentEnd };
}

// ── Keymaps ───────────────────────────────────────────────────────────────

// Every block the caret types in binds these, so a chord means the same in a paragraph, a cell and a
// code block (which swallows them, having no inline constructs).
const INLINE_FORMAT_KEYMAP: readonly KeyBinding[] = [
	{ chord: 'Mod+B', command: 'format.toggleStrong' },
	{ chord: 'Mod+I', command: 'format.toggleEmphasis' },
	{ chord: 'Mod+Shift+X', command: 'format.toggleStrikethrough' },
	{ chord: 'Mod+E', command: 'format.toggleCode' },
	// The live-mode link card. The chord is taken even where no card opens, since letting it
	// through would trigger the browser's own Mod+K.
	{ chord: 'Mod+K', command: 'link.openCard' }
];

const INLINE_FORMAT_COMMANDS = new Set<string>(INLINE_FORMAT_KEYMAP.map((b) => b.command));

/** Whether a command is one of the format chords every typing block binds. */
export function isInlineFormatCommand(command: string): boolean {
	return INLINE_FORMAT_COMMANDS.has(command);
}

// Shared by every kind TextEditableBlock renders, prose and the raw-editable fallback alike, so
// the chords that transform a block behave the same in all of them.
const TEXT_EDITABLE_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Shift+Enter', command: 'block.hardBreak' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
	...INLINE_FORMAT_KEYMAP,
	{ chord: 'Mod+0', command: 'heading.cycle', arg: 0 },
	{ chord: 'Mod+1', command: 'heading.cycle', arg: 1 },
	{ chord: 'Mod+2', command: 'heading.cycle', arg: 2 },
	{ chord: 'Mod+3', command: 'heading.cycle', arg: 3 },
	{ chord: 'Mod+4', command: 'heading.cycle', arg: 4 },
	{ chord: 'Mod+5', command: 'heading.cycle', arg: 5 },
	{ chord: 'Mod+6', command: 'heading.cycle', arg: 6 }
];

/** The keys a plugin's text block binds: a paragraph's without the heading chords, and without the
 *  format chords where its text is literal. */
export function pluginTextKeymap(markdown: boolean, multiLine: boolean): KeyBinding[] {
	// A text spanning lines takes Enter as a line break, as a code block's does.
	const skipped = multiLine
		? ['heading.cycle', 'block.split', 'block.hardBreak']
		: ['heading.cycle'];
	return TEXT_EDITABLE_KEYMAP.filter(
		(b) => !skipped.includes(b.command) && (markdown || !isInlineFormatCommand(b.command))
	);
}

// The cell holds the caret inside a table, so the table's keys bind here; a `table` override would
// miss. Plain arrows depend on the caret's position, so `cell-keydown-plan.ts` handles them.
const TABLE_CELL_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'cell.enter' },
	{ chord: 'Shift+Enter', command: 'cell.lineBreak' },
	{ chord: 'Tab', command: 'cell.tab' },
	{ chord: 'Shift+Tab', command: 'cell.shiftTab' },
	...INLINE_FORMAT_KEYMAP,
	{ chord: 'Mod+Enter', command: 'table.insertRowBelow' },
	{ chord: 'Mod+Shift+Enter', command: 'table.insertRowAbove' },
	{ chord: 'Alt+Shift+ArrowRight', command: 'table.insertColumnRight' },
	{ chord: 'Alt+Shift+ArrowLeft', command: 'table.insertColumnLeft' },
	{ chord: 'Mod+Shift+Backspace', command: 'table.deleteRow' },
	{ chord: 'Alt+Shift+Backspace', command: 'table.deleteColumn' },
	{ chord: 'Alt+ArrowUp', command: 'table.moveRowUp' },
	{ chord: 'Alt+ArrowDown', command: 'table.moveRowDown' },
	{ chord: 'Alt+ArrowLeft', command: 'table.moveColumnLeft' },
	{ chord: 'Alt+ArrowRight', command: 'table.moveColumnRight' },
	{ chord: 'Mod+Shift+A', command: 'table.cycleAlignment' },
	// The keyboard's right-click: the browser's own context menu would open over the cell.
	{ chord: 'Shift+F10', command: 'cell.openMenu' },
	{ chord: 'ContextMenu', command: 'cell.openMenu' },
	// Moves the whole table among its siblings, since Alt+Arrow, the reorder chord every other
	// kind uses, moves the row the caret is in.
	{ chord: 'Mod+Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Mod+Alt+ArrowDown', command: 'block.moveDown' }
];

// ── Inline-construct policies ───────────────────────────────────────────────

// Registered next to the block descriptors rather than from the component layer, so a consumer
// with no UI, and the unit tests that load only this module, read the same rows.
function registerBuiltInInlinePolicies(): void {
	// Outermost first, and code is innermost because its content is literal: no other mark can
	// take effect inside it.
	const marks = [
		{ kind: 'strong', edge: 'left-sticky', markerBytes: '**', command: 'format.toggleStrong' },
		{ kind: 'emphasis', edge: 'left-sticky', markerBytes: '*', command: 'format.toggleEmphasis' },
		{
			kind: 'strikethrough',
			edge: 'left-sticky',
			markerBytes: '~~',
			command: 'format.toggleStrikethrough'
		},
		// A code span paints a chip, whose border gives its edge two visible caret stops.
		{
			kind: 'inlineCode',
			edge: 'boxed',
			markerBytes: '`',
			command: 'format.toggleCode',
			wrapBytes: asCodeSpan
		}
	] as const;
	marks.forEach(({ kind, edge, ...mark }, nestingRank) => {
		registerInlineConstructPolicy(kind, {
			edgeAffinity: edge,
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true,
			// A code span's content is literal, so a `#` typed there is code, not a tag.
			prose: kind === 'inlineCode' ? 'none' : 'all',
			mark: { nestingRank, ...mark }
		});
	});
	// A link's closer is its URL, not a mirror of its opener, so neither edge extends; the
	// split rebalancer is what duplicates the URL across the halves.
	registerInlineConstructPolicy('link', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: true,
		splitBehavior: 'close-and-reopen',
		revealable: true,
		followEdit: 'card',
		// The text is prose; the destination and the title are not.
		prose: 'content'
	});
	// An image with an empty alt is still an image, and a split inside one moves bytes only.
	registerInlineConstructPolicy('image', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: false,
		splitBehavior: 'plain',
		revealable: true,
		// Its alt text is an attribute of the picture, not prose on the page.
		prose: 'none'
	});
	// An autolink's text is its destination, so neither edge extends (`docs/design/live-mode.md`
	// § 4.2 Typing at a hidden edge) and half a URL is no URL; the link card edits it like a link.
	registerInlineConstructPolicy('autolink', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: false,
		splitBehavior: 'whole',
		revealable: false,
		followEdit: 'card',
		prose: 'none'
	});
	// Always hidden in live mode, and a key deletes each as one unit. Half an escape is a literal
	// backslash, so a split takes it whole; a hard break's moved cut doesn't parse back.
	for (const [kind, splitBehavior] of [
		['escape', 'whole'],
		['hardLineBreak', 'plain']
	] as const) {
		registerInlineConstructPolicy(kind, {
			edgeAffinity: 'never-extend',
			autoUnwrapOnEmpty: false,
			splitBehavior,
			revealable: false
		});
	}
}

// ── Built-in registrations ──────────────────────────────────────────────────

// Stops a second run rather than skipping the registries: both entry points call this, and on a
// dev server a re-evaluation resets the flag so a repeat registration still replaces.
let registered = false;

export function registerBuiltInDescriptors(): void {
	if (registered) return;
	registered = true;
	// Built-ins belong to no plugin, even when the first caller runs inside a plugin's setup, so the
	// test reset keeps them.
	registerAsCore(registerBuiltIns);
}

function registerBuiltIns(): void {
	registerBuiltInInlinePolicies();
	registerTableCompleter();

	registerBuiltinBlockKind('paragraph', {
		pageRole: 'prose',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'prose',
		editable: true,
		supportsInline: true,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'hello world\n'
	});
	registerBuiltinBlockKind('heading', {
		opener: BUILT_IN_OPENERS.heading,
		pageRole: 'prose',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		// Live mode shows no `## `, so the first Backspace the user can aim at it removes the
		// structure they can see; the second merges, through the usual path.
		contentStart: { range: headingContentRange, backspace: 'demote-first' },
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '# Heading\n'
	});
	registerBuiltinBlockKind('setextHeading', {
		pageRole: 'prose',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		contentStart: { range: setextHeadingContentRange, backspace: 'demote-first' },
		rawWrite: setextHeadingWrite,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'Title\n===\n'
	});
	registerBuiltinBlockKind('fencedCode', {
		opener: BUILT_IN_OPENERS.fencedCode,
		pageRole: 'object',
		dragLabel: 'Code',
		estimateHeight: sourceLinesEstimate,
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Enter inside the fence writes a code newline, so neither edge can grow a sibling.
		gapEdges: 'both',
		rawWrite: fencedCodeWrite,
		keymap: [
			{ chord: 'Enter', command: 'code.newline' },
			{ chord: 'Shift+Enter', command: 'code.softBreak' },
			{ chord: 'Tab', command: 'code.indent' },
			{ chord: 'Shift+Tab', command: 'code.dedent' },
			{ chord: 'Backspace', command: 'code.backspace' },
			{ chord: 'Delete', command: 'code.delete' },
			{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
			{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
			...INLINE_FORMAT_KEYMAP
		],
		conformanceFixture: '```\ncode\n```\n'
	});
	registerBuiltinBlockKind('thematicBreak', {
		opener: BUILT_IN_OPENERS.thematicBreak,
		pageRole: 'object',
		dragLabel: 'Divider',
		estimateHeight: singleLineEstimate,
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		blockFocus: 'whole-block',
		// Leading edge only: its focused Enter already inserts a paragraph below.
		gapEdges: 'before',
		conformanceFixture: '---\n'
	});
	registerBuiltinBlockKind('indentedCode', {
		opener: BUILT_IN_OPENERS.indentedCode,
		pageRole: 'object',
		estimateHeight: sourceLinesEstimate,
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '    indented code\n'
	});
	registerBuiltinBlockKind('htmlBlock', {
		opener: BUILT_IN_OPENERS.htmlBlock,
		pageRole: 'object',
		estimateHeight: sourceLinesEstimate,
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '<div>\nhtml\n</div>\n'
	});
	registerBuiltinBlockKind('linkReferenceDefinition', {
		opener: BUILT_IN_OPENERS.linkReferenceDefinition,
		pageRole: 'object',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '[id]: /url "title"\n'
	});
	registerBuiltinBlockKind('table', {
		pageRole: 'object',
		estimateHeight: containerEstimate,
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Enter inside a cell stays in the grid, so neither edge can grow a sibling.
		gapEdges: 'both',
		container: {
			contract: 'grid',
			rebuildRaw: rebuildTableRaw,
			lastLineChild: tableLastLineChild
		},
		conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n'
	});
	registerBuiltinBlockKind('tableRow', {
		pageRole: 'object',
		estimateHeight: containerEstimate,
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		container: { contract: 'grid', rebuildRaw: rebuildTableRowRaw },
		conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n'
	});
	registerBuiltinBlockKind('tableCell', {
		pageRole: 'prose',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: true,
		contextDependentKind: true,
		rawWrite: tableCellWrite,
		renderImagesAsWidgets: false,
		keymap: TABLE_CELL_KEYMAP
		// No `conformanceFixture`: the table opener creates the cells, so one is never the
		// top-level result of a document scan.
	});
	registerBuiltinBlockKind('unrecognized', {
		pageRole: 'object',
		estimateHeight: proseEstimate,
		gapEdges: 'none',
		mergeRole: 'self-merge',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP
		// No `conformanceFixture`: it is the fallback for content no opener took, so a document
		// scan never produces it on its own.
	});
	registerBuiltinBlockKind('blockquote', {
		opener: BUILT_IN_OPENERS.blockquote,
		pageRole: 'prose',
		estimateHeight: containerEstimate,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			lines: QUOTE_LINES,
			merges: {},
			unwrapRole: {
				firstChildBackspace: 'lift-first-child-drop-opener',
				middleChildBackspace: 'default-merge'
			},
			contentStartSpace: 'complete-marker',
			reorderChildren: {}
		},
		conformanceFixture: '> quoted\n'
	});
	registerBuiltinBlockKind('list', {
		opener: BUILT_IN_OPENERS.list,
		// Its items carry the handles: one on the list would sit over its first item's.
		pageRole: 'prose',
		estimateHeight: containerEstimate,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'strip',
			rebuildRaw: rebuildListRaw,
			merges: { key: 'ordered' },
			unwrapRole: {
				firstChildBackspace: 'list-item-cascade',
				middleChildBackspace: 'list-item-cascade'
			},
			reorderChildren: {}
		},
		conformanceFixture: '- item\n'
	});
	registerBuiltinBlockKind('listItem', {
		pageRole: 'object',
		estimateHeight: containerEstimate,
		gapEdges: 'none',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: { lines: LIST_ITEM_LINES },
		keymap: [
			{ chord: 'Tab', command: 'list.indent' },
			{ chord: 'Shift+Tab', command: 'list.unindent' },
			{ chord: 'Mod+Enter', command: 'list.toggleTask' }
		],
		conformanceFixture: '- item\n'
	});
	// Over a range, the item holding each covered line nests or lifts, as at a caret.
	setBuiltInRangeIndent('listItem', 'list.indent', { item: 'nest' });
	setBuiltInRangeIndent('listItem', 'list.unindent', { item: 'lift' });
}

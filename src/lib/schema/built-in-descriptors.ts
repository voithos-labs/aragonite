/**
 * Built-in block-kind descriptors and inline-construct policies, applied by an EXPLICIT
 * `registerBuiltInDescriptors()` call from the two descriptor-read entry points,
 * `core/inline/index.ts` and `components/built-in-blocks.ts`: the production build tree-shakes a
 * bare side-effect import of a module outside the `sideEffects` allowlist, where a used binding
 * cannot be dropped. Split from `block-kind-descriptor.ts` so that module carries no payload.
 */

import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import { containerClosure, type ClosureBlock } from './closure';
import type { KeyBinding } from './keybindings';
import { registerBlockKind } from './block-kind-descriptor';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from './container-rebuilders';
import { normalizeCellRaw } from './table-cell-raw';
import { normalizeFencedRaw } from './fenced-code-raw';
import { registerInlineConstructPolicy } from './inline-construct-policy';

// ── Content-range helpers ──────────────────────────────────────────────────

// Headings carry a `# ` prefix that is not part of the editable text.
function headingContentRange(node: NodeView): { start: number; end: number } {
	const raw = node.raw;
	const displayEnd = displayLength(raw);
	let i = 0;
	while (i < raw.length && raw[i] === ' ') i++;
	while (i < raw.length && raw[i] === '#') i++;
	if (i < raw.length && raw[i] === ' ') i++;
	return { start: i, end: displayEnd };
}

// Setext headings carry a trailing underline line that is structural, not content.
function setextHeadingContentRange(node: NodeView): { start: number; end: number } {
	const raw = node.raw;
	const end = displayLength(raw);
	const underlineStart = raw.lastIndexOf('\n', end - 1);
	if (underlineStart === -1) return { start: 0, end };
	let contentEnd = underlineStart;
	if (contentEnd > 0 && raw[contentEnd - 1] === '\r') contentEnd--;
	return { start: 0, end: contentEnd };
}

// Cells have no markers; the entire raw is content.
function tableCellContentRange(node: NodeView): { start: number; end: number } {
	return { start: 0, end: displayLength(node.raw) };
}

// ── Keymaps ───────────────────────────────────────────────────────────────

// Shared by every kind TextEditableBlock renders — prose and the raw-editable fallback alike —
// so transformative chords behave identically across them.
const TEXT_EDITABLE_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Shift+Enter', command: 'block.hardBreak' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
	{ chord: 'Mod+B', command: 'format.toggleStrong' },
	{ chord: 'Mod+I', command: 'format.toggleEmphasis' },
	{ chord: 'Mod+Shift+X', command: 'format.toggleStrikethrough' },
	{ chord: 'Mod+E', command: 'format.toggleCode' },
	// The live-mode link card. Consumed even when no card opens (a caret outside every link
	// no-ops): `reservedChords()` reports the chord as claimed, and a fall-through would run the
	// browser's own Mod+K.
	{ chord: 'Mod+K', command: 'link.openCard' },
	{ chord: 'Mod+0', command: 'heading.cycle', arg: 0 },
	{ chord: 'Mod+1', command: 'heading.cycle', arg: 1 },
	{ chord: 'Mod+2', command: 'heading.cycle', arg: 2 },
	{ chord: 'Mod+3', command: 'heading.cycle', arg: 3 },
	{ chord: 'Mod+4', command: 'heading.cycle', arg: 4 },
	{ chord: 'Mod+5', command: 'heading.cycle', arg: 5 },
	{ chord: 'Mod+6', command: 'heading.cycle', arg: 6 }
];

// The cell is the focused surface inside a table, so the table's whole keyboard vocabulary binds
// on THIS kind — an override scoped to `table` would resolve against a block that never holds
// the caret. Plain arrows stay unbound: they depend on caret position, which a chord can't
// express, so they live in `cell-keydown-plan.ts`.
const TABLE_CELL_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'cell.enter' },
	{ chord: 'Tab', command: 'cell.tab' },
	{ chord: 'Shift+Tab', command: 'cell.shiftTab' },
	{ chord: 'Mod+B', command: 'format.toggleStrong' },
	{ chord: 'Mod+I', command: 'format.toggleEmphasis' },
	{ chord: 'Mod+Shift+X', command: 'format.toggleStrikethrough' },
	{ chord: 'Mod+E', command: 'format.toggleCode' },
	{ chord: 'Mod+K', command: 'link.openCard' },
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
	// The whole table among its siblings. Alt+Arrow, every other kind's reorder chord, is taken
	// by the row reorder a cell caret means first.
	{ chord: 'Mod+Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Mod+Alt+ArrowDown', command: 'block.moveDown' }
];

// ── Closure blocks ────────────────────────────────────────────────────────────

// Shared by the not-mergeable, non-inline raw-text leaves — byte-identical rows, hoisted rather
// than triplicated. fencedCode and unrecognized diverge, so they stay inline.
const RAW_TEXT_LEAF_CLOSURE: ClosureBlock = {
	roundTrip: { mode: 'inherit-default' },
	focus: { mode: 'implemented', via: 'native caret in the raw-editable contenteditable' },
	mergeBackspace: {
		mode: 'implemented',
		via: 'mergeRole=not-mergeable — Backspace moves focus, never concatenates'
	},
	selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
	searchPaint: { mode: 'implemented', via: 'raw scanned; matches painted as decoration marks' },
	reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
	undo: { mode: 'inherit-default' },
	clipboard: { mode: 'inherit-default' },
	simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
};

// The prose trio share a closure differing only in three via strings. Bake the
// structurally-fixed rows; demand the varying vias so the honesty rule stays author-supplied.
function proseLeafClosure(vias: {
	mergeBackspaceVia: string;
	selectionPaintVia: string;
	searchPaintVia: string;
	reorderVia?: string;
}): ClosureBlock {
	return {
		roundTrip: { mode: 'inherit-default' },
		focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
		mergeBackspace: { mode: 'implemented', via: vias.mergeBackspaceVia },
		selectionPaint: { mode: 'implemented', via: vias.selectionPaintVia },
		searchPaint: { mode: 'implemented', via: vias.searchPaintVia },
		reorder: { mode: 'implemented', via: vias.reorderVia ?? 'Alt+Arrow block.move keymap' },
		undo: { mode: 'inherit-default' },
		clipboard: { mode: 'inherit-default' },
		simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
	};
}

// ── Inline-construct policies ───────────────────────────────────────────────

// Registered beside the block descriptors rather than from the component layer so a headless
// consumer — and the unit bootstrap, which loads only this module — reads the same rows.
function registerBuiltInInlinePolicies(): void {
	for (const kind of ['emphasis', 'strong', 'strikethrough', 'inlineCode'] as const) {
		registerInlineConstructPolicy(kind, {
			edgeAffinity: 'symmetric-pair',
			autoUnwrapOnEmpty: true,
			splitBehavior: 'close-and-reopen',
			revealable: true
		});
	}
	// A link's closer is its URL, not a mirror of its opener, so neither edge extends; the
	// split rebalancer is what duplicates the URL across the halves.
	registerInlineConstructPolicy('link', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: true,
		splitBehavior: 'close-and-reopen',
		revealable: true
	});
	// An image with an empty alt is still an image, and a split inside one moves bytes only.
	registerInlineConstructPolicy('image', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: false,
		splitBehavior: 'plain',
		revealable: true
	});
	// An autolink's `<`/`>` are a link's delimiters by another spelling: the destination IS the
	// text, so a byte landing between the brackets rewrites where the link goes. Never-extend, for
	// the same reason the bracket form is (live-mode.md § 4.2), and plain: two halves of a URL
	// are not two URLs.
	registerInlineConstructPolicy('autolink', {
		edgeAffinity: 'never-extend',
		autoUnwrapOnEmpty: false,
		splitBehavior: 'plain',
		revealable: false
	});
	// Unstamped marker runs, permanently hidden in live mode: the `\X` pair and the trailing-space
	// run delete as a unit, so nothing may rewrite their markers around an edit.
	for (const kind of ['escape', 'hardLineBreak'] as const) {
		registerInlineConstructPolicy(kind, {
			edgeAffinity: 'never-extend',
			autoUnwrapOnEmpty: false,
			splitBehavior: 'plain',
			revealable: false
		});
	}
}

// ── Built-in registrations ──────────────────────────────────────────────────

// Idempotence guard, not a registry bypass: both entry points call this, and a
// dev-server re-eval resets it so the register-once dev valve still replaces.
let registered = false;

export function registerBuiltInDescriptors(): void {
	if (registered) return;
	registered = true;

	registerBuiltInInlinePolicies();

	registerBlockKind('paragraph', {
		mergeRole: 'prose',
		editable: true,
		supportsInline: true,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'hello world\n',
		closure: proseLeafClosure({
			mergeBackspaceVia: 'mergeRole=prose — Backspace merges into the previous prose block',
			selectionPaintVia: 'measurePartialRects (raw offsets, per visual line)',
			searchPaintVia: 'prose raw scanned; matches painted as marks',
			reorderVia: 'Alt+Arrow block.move keymap; resolveReorderUnit'
		})
	});
	registerBlockKind('heading', {
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		getContentRange: headingContentRange,
		// Live paints no `## `, so the first Backspace a user can aim at it takes the structure
		// they CAN see; the second one merges, through the untouched cascade.
		contentStartBackspace: 'demote-first',
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '# Heading\n',
		closure: proseLeafClosure({
			mergeBackspaceVia: 'mergeRole=prose-absorber — absorbs the following prose block',
			selectionPaintVia: 'measurePartialRects (content range, marker skipped)',
			searchPaintVia: 'content-range raw scanned; marks (marker prefix skipped)'
		})
	});
	registerBlockKind('setextHeading', {
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		getContentRange: setextHeadingContentRange,
		contentStartBackspace: 'demote-first',
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'Title\n===\n',
		closure: proseLeafClosure({
			mergeBackspaceVia: 'mergeRole=prose-absorber — absorbs the following prose block',
			selectionPaintVia: 'measurePartialRects (content range, underline skipped)',
			searchPaintVia: 'content-range raw scanned; marks (underline line skipped)'
		})
	});
	registerBlockKind('fencedCode', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Enter inside the fence writes a code newline, so neither edge can grow a sibling.
		gapEdges: 'both',
		normalizeRawWrite: normalizeFencedRaw,
		keymap: [
			{ chord: 'Enter', command: 'code.newline' },
			{ chord: 'Tab', command: 'code.indent' },
			{ chord: 'Shift+Tab', command: 'code.dedent' },
			{ chord: 'Backspace', command: 'code.backspace' },
			{ chord: 'Delete', command: 'code.delete' },
			{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
			{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
			{ chord: 'Mod+B', command: 'format.toggleStrong' },
			{ chord: 'Mod+I', command: 'format.toggleEmphasis' },
			{ chord: 'Mod+Shift+X', command: 'format.toggleStrikethrough' },
			{ chord: 'Mod+E', command: 'format.toggleCode' },
			{ chord: 'Mod+K', command: 'link.openCard' }
		],
		conformanceFixture: '```\ncode\n```\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the code contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — code.backspace edits within; no cross-block concat'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (raw offsets, per visual line)'
			},
			searchPaint: { mode: 'implemented', via: 'code raw scanned; matches painted as marks' },
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
		}
	});
	registerBlockKind('thematicBreak', {
		mergeRole: 'not-mergeable',
		editable: false,
		supportsInline: false,
		blockFocus: 'whole-block',
		// Leading edge only: its focused Enter already inserts a paragraph below.
		gapEdges: 'before',
		keymap: [
			{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
			{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
		],
		conformanceFixture: '---\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: {
				mode: 'implemented',
				via: 'blockFocus=whole-block — focus-then-delete; ThematicBreakBlock supplies the focus surface'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'blockFocus=whole-block — caret-adjacent Backspace focuses, a second press deletes'
			},
			selectionPaint: { mode: 'implemented', via: 'whole-block cover rect (no partial offsets)' },
			searchPaint: {
				mode: 'not-supported',
				reason: 'no editable text content — nothing to search'
			},
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'focused-block Mod+C/Mod+X (handleWholeBlockKeys); cross-block slice inherits the default'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
		}
	});
	registerBlockKind('indentedCode', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '    indented code\n',
		closure: RAW_TEXT_LEAF_CLOSURE
	});
	registerBlockKind('htmlBlock', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '<div>\nhtml\n</div>\n',
		closure: RAW_TEXT_LEAF_CLOSURE
	});
	registerBlockKind('linkReferenceDefinition', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '[id]: /url "title"\n',
		closure: RAW_TEXT_LEAF_CLOSURE
	});
	registerBlockKind('table', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		// Enter inside a cell stays in the grid, so neither edge can grow a sibling.
		gapEdges: 'both',
		container: { contract: 'grid', rebuildRaw: rebuildTableRaw },
		conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=grid — rebuildTableRaw' },
			focus: { mode: 'implemented', via: 'focus walks into the first cell' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — no block merge; edits stay within cells'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'rectangular cell selection; per-cell cover rects'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'descends to cells; per-cell mark overlay (measurePartialRects cell index)'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'rectangular multi-cell copy → synthesized GFM sub-table, not a byte slice (copyRectangleAsSubTable, cell index)'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation drives table cell edits' }
		}
	});
	registerBlockKind('tableRow', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		container: { contract: 'grid', rebuildRaw: rebuildTableRowRaw },
		conformanceFixture: '| a | b |\n| - | - |\n| 1 | 2 |\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=grid — rebuildTableRowRaw' },
			focus: { mode: 'implemented', via: 'focus walks into a cell' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — no row-level merge; cell edits only'
			},
			selectionPaint: { mode: 'implemented', via: 'per-cell cover rects' },
			searchPaint: { mode: 'implemented', via: 'descends to cells; per-cell mark overlay' },
			reorder: {
				mode: 'not-supported',
				reason:
					'grid child — not a block-level reorder unit; whole rows move via a row-drag gesture inside the table grid, not the BlockList'
			},
			undo: { mode: 'inherit-default' },
			// inherit-default, unlike table/tableCell: no clipboard path anchors on a row node,
			// so the row's per-cell painting does not extend to being a copy source.
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation (table edits)' }
		}
	});
	registerBlockKind('tableCell', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: true,
		contextDependentKind: true,
		normalizeRawWrite: normalizeCellRaw,
		getContentRange: tableCellContentRange,
		renderImagesAsWidgets: false,
		keymap: TABLE_CELL_KEYMAP,
		// No conformanceFixture: the table opener mints cells, so one never stands alone as the
		// top-level result of a document scan.
		closure: {
			roundTrip: {
				mode: 'implemented',
				via: 'contextDependentKind — the parent grid rebuildTableRaw owns the cell bytes'
			},
			focus: { mode: 'implemented', via: 'per-cell native caret' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — edits stay within the cell; no cross-cell concat'
			},
			selectionPaint: { mode: 'implemented', via: 'measurePartialRects (cell index)' },
			searchPaint: {
				mode: 'implemented',
				via: 'cell raw scanned; per-cell mark overlay (measurePartialRects cell index)'
			},
			reorder: {
				mode: 'not-supported',
				reason:
					'grid cell — not a block-level reorder unit; row/column drag gestures inside the table grid move whole rows or columns, not individual cells'
			},
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'copy/cut synthesize a GFM sub-table for the selected rectangle (intraTableRectPayload → copyRectangleAsSubTable, cell index)'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation (table cell edits)' }
		}
	});
	registerBlockKind('unrecognized', {
		mergeRole: 'self-merge',
		editable: true,
		supportsInline: false,
		keymap: TEXT_EDITABLE_KEYMAP,
		// No conformanceFixture: it is the reserved fallback for content no opener claimed, so a
		// document scan never yields it in isolation.
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the raw-editable contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=self-merge — concatenates with an adjacent unrecognized block'
			},
			selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
			searchPaint: { mode: 'implemented', via: 'raw scanned; matches painted as marks' },
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'inherit-default' }
		}
	});
	registerBlockKind('blockquote', {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'strip',
			rebuildRaw: rebuildBlockquoteRaw,
			containerPaste: { matchesAncestor: () => true, siblingAbsorb: false },
			unwrapRole: {
				firstChildBackspace: 'lift-first-child',
				middleChildBackspace: 'default-merge',
				quoteShaped: true
			},
			reorderChildren: {}
		},
		conformanceFixture: '> quoted\n',
		closure: containerClosure({
			roundTripVia: 'container contract=strip — rebuildBlockquoteRaw',
			focus: { mode: 'implemented', via: 'focus walks into the first child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (lift-first-child; default-merge)'
			},
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'containerPaste.matchesAncestor — clipboard top merges into a same-kind ancestor'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation (nested blockquote edits)' }
		})
	});
	registerBlockKind('list', {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'strip',
			rebuildRaw: rebuildListRaw,
			containerPaste: {
				matchesAncestor: (top, ancestor) =>
					(metadataOf(top, 'list')?.ordered ?? false) ===
					(metadataOf(ancestor, 'list')?.ordered ?? false),
				siblingAbsorb: true
			},
			unwrapRole: {
				firstChildBackspace: 'list-item-cascade',
				middleChildBackspace: 'list-item-cascade'
			},
			reorderChildren: { renumberMarkers: true }
		},
		conformanceFixture: '- item\n',
		closure: containerClosure({
			roundTripVia: 'container contract=strip — rebuildListRaw',
			focus: { mode: 'implemented', via: 'focus walks into the first item' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (list-item-cascade)'
			},
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'containerPaste.siblingAbsorb — clipboard items splice as siblings, ordered-flag matched'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation (list edits)' }
		})
	});
	registerBlockKind('listItem', {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: { contract: 'strip', rebuildRaw: rebuildListItemRaw },
		keymap: [
			{ chord: 'Tab', command: 'list.indent' },
			{ chord: 'Shift+Tab', command: 'list.unindent' }
		],
		conformanceFixture: '- item\n',
		closure: containerClosure({
			roundTripVia: 'container contract=strip — rebuildListItemRaw',
			focus: { mode: 'implemented', via: 'focus walks into the first child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container — Backspace cascades via the parent list unwrapRole'
			},
			reorder: {
				mode: 'implemented',
				via: 'list.indent/unindent keymap; whole-item reorder through the parent list'
			},
			undo: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation (list item edits)' }
		})
	});
}

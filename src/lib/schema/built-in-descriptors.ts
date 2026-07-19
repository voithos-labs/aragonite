/**
 * Built-in block-kind descriptor registrations, applied by an EXPLICIT
 * `registerBuiltInDescriptors()` call from the two descriptor-read entry
 * points: `core/inline/index.ts` (the headless parse/inline surface) and
 * `components/built-in-blocks.ts` (the editor mount, which augments the
 * built-in `table` descriptor and so needs it registered first). A bare
 * side-effect import is NOT enough: the production Rollup build tree-shakes
 * an unused import of a module the package's `sideEffects` allowlist doesn't
 * cover, and the prod SSR bundle shipped with zero kinds registered exactly
 * that way. A used binding cannot be dropped. Split out of
 * `block-kind-descriptor.ts` so the contract/registry/API module carries no
 * registration payload — mirrors `core/parsers/built-in-openers.ts` and
 * `components/built-in-blocks.ts`.
 */

import { metadataOf } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { displayLength } from '../core/lines';
import type { ClosureBlock } from './closure';
import type { KeyBinding } from './keybindings';
import { registerBlockKind } from './block-kind-descriptor';
import {
	rebuildBlockquoteRaw,
	rebuildListItemRaw,
	rebuildListRaw,
	rebuildTableRaw,
	rebuildTableRowRaw
} from './container-rebuilders';

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

// Shared by every kind TextEditableBlock renders — prose and the raw-editable
// fallback alike — so transformative chords behave identically across them. The
// component's runCommand implements each command.
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
	{ chord: 'Mod+0', command: 'heading.cycle', arg: 0 },
	{ chord: 'Mod+1', command: 'heading.cycle', arg: 1 },
	{ chord: 'Mod+2', command: 'heading.cycle', arg: 2 },
	{ chord: 'Mod+3', command: 'heading.cycle', arg: 3 },
	{ chord: 'Mod+4', command: 'heading.cycle', arg: 4 },
	{ chord: 'Mod+5', command: 'heading.cycle', arg: 5 },
	{ chord: 'Mod+6', command: 'heading.cycle', arg: 6 }
];

// ── Closure blocks ────────────────────────────────────────────────────────────

// Shared by the not-mergeable, non-inline raw-text leaves (indentedCode,
// htmlBlock, linkReferenceDefinition) — byte-identical rows, hoisted rather than
// triplicated. fencedCode and unrecognized diverge (own keymap / self-merge), so
// they stay inline.
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

// ── Built-in registrations ──────────────────────────────────────────────────

// Idempotence guard, not a registry bypass: both entry points call this, and a
// dev-server re-eval resets it so the register-once dev valve still replaces.
let registered = false;

export function registerBuiltInDescriptors(): void {
	if (registered) return;
	registered = true;

	registerBlockKind('paragraph', {
		mergeRole: 'prose',
		editable: true,
		supportsInline: true,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'hello world\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=prose — Backspace merges into the previous prose block'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (raw offsets, per visual line)'
			},
			searchPaint: { mode: 'implemented', via: 'prose raw scanned; matches painted as marks' },
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap; resolveReorderUnit' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
		}
	});
	registerBlockKind('heading', {
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		getContentRange: headingContentRange,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: '# Heading\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=prose-absorber — absorbs the following prose block'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (content range, marker skipped)'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'content-range raw scanned; marks (marker prefix skipped)'
			},
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
		}
	});
	registerBlockKind('setextHeading', {
		mergeRole: 'prose-absorber',
		editable: true,
		supportsInline: true,
		getContentRange: setextHeadingContentRange,
		keymap: TEXT_EDITABLE_KEYMAP,
		conformanceFixture: 'Title\n===\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the prose contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=prose-absorber — absorbs the following prose block'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'measurePartialRects (content range, underline skipped)'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'content-range raw scanned; marks (underline line skipped)'
			},
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation under the loaded-ops oracles' }
		}
	});
	registerBlockKind('fencedCode', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		keymap: [
			{ chord: 'Enter', command: 'code.newline' },
			{ chord: 'Tab', command: 'code.indent' },
			{ chord: 'Shift+Tab', command: 'code.dedent' },
			{ chord: 'Backspace', command: 'code.backspace' },
			{ chord: 'Delete', command: 'code.delete' },
			{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
			{ chord: 'Alt+ArrowDown', command: 'block.moveDown' },
			{ chord: 'Mod+B', command: 'format.toggleStrong' },
			{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
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
		keymap: [
			{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
			{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
		],
		conformanceFixture: '---\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: {
				mode: 'implemented',
				via: 'ThematicBreakBlock whole-block focus (focus-then-delete model)'
			},
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — caret-adjacent Backspace focuses, a second press deletes'
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
			// inherit-default, not implemented like table/tableCell: no clipboard path
			// anchors on a row node — the rectangular sub-table copy reads the table,
			// the copy/cut handlers live on the cell. The row paints per-cell but is
			// never a copy source, so selectionPaint: implemented does not extend here.
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation (table edits)' }
		}
	});
	registerBlockKind('tableCell', {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: true,
		contextDependentKind: true,
		getContentRange: tableCellContentRange,
		renderImagesAsWidgets: false,
		keymap: [
			{ chord: 'Enter', command: 'cell.enter' },
			{ chord: 'Tab', command: 'cell.tab' },
			{ chord: 'Shift+Tab', command: 'cell.shiftTab' },
			{ chord: 'Mod+B', command: 'format.toggleStrong' },
			{ chord: 'Mod+I', command: 'format.toggleEmphasis' }
		],
		// No conformanceFixture: context-dependent — the table opener mints cells, so a
		// cell never stands alone as the top-level result of a document scan.
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
		// No conformanceFixture: a document scan never yields `unrecognized` in
		// isolation — it is the reserved fallback for content no opener claimed.
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
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: '> quoted\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildBlockquoteRaw' },
			focus: { mode: 'implemented', via: 'focus walks into the first child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (lift-first-child; default-merge)'
			},
			selectionPaint: {
				mode: 'implemented',
				via: 'real child blocks paint; container cover spans them'
			},
			searchPaint: {
				mode: 'implemented',
				via: 'children are real blocks — search descends and paints'
			},
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'containerPaste.matchesAncestor — clipboard top merges into a same-kind ancestor'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation (nested blockquote edits)' }
		}
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
			}
		},
		conformanceFixture: '- item\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildListRaw' },
			focus: { mode: 'implemented', via: 'focus walks into the first item' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (list-item-cascade)'
			},
			selectionPaint: { mode: 'implemented', via: 'item child blocks paint; container cover' },
			searchPaint: { mode: 'implemented', via: 'descends into items — mark overlay per child' },
			reorder: { mode: 'implemented', via: 'whole-block reorder through the parent BlockList' },
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'containerPaste.siblingAbsorb — clipboard items splice as siblings, ordered-flag matched'
			},
			simOracle: { mode: 'implemented', via: 'note-taking simulation (list edits)' }
		}
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
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=strip — rebuildListItemRaw' },
			focus: { mode: 'implemented', via: 'focus walks into the first child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container — Backspace cascades via the parent list unwrapRole'
			},
			selectionPaint: { mode: 'implemented', via: 'child blocks paint; item cover' },
			searchPaint: { mode: 'implemented', via: 'descends into item children — mark overlay' },
			reorder: {
				mode: 'implemented',
				via: 'list.indent/unindent keymap; whole-item reorder through the parent list'
			},
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'note-taking simulation (list item edits)' }
		}
	});
}

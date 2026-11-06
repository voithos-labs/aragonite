/**
 * Generic fallback kinds for the `:::name` directive primitive, so `:::anything` stays lossless
 * with no plugin installed. Every `:::` container is written from the colon line shape, which
 * keeps its first child, the opener line, as it stands. Imports stay core-relative because the
 * plugin barrel (`plugin.ts`) would cycle back through core.
 */

import {
	declarePluginKind,
	declarePluginInlineKind,
	isInlineKindDeclared
} from '../../schema/plugin-kind';
import { registerBlockKind, isBlockKindRegistered } from '../../schema/block-kind-descriptor';
import type { BlockView } from '../../schema/block-view';
import { containerClosure } from '../../schema/closure';
import { registerTitleRowLeaf } from '../../schema/title-row-leaf';
import type { KeyBinding } from '../../schema/keybindings';
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { displayLength, trimTrailingLineEnding } from '../lines';
import { registerCoreInlineWidget } from '../inline/inline-widgets';
import { mintWidgetShell } from '../inline/widget-shell';
import { matchDirectiveOpener } from './grammar';
import { directiveContainerOpener } from './container-opener';
import { DIRECTIVE_CONTAINER, DIRECTIVE_OPENER_LINE } from './container-shape';
import { COLON_LINES } from '../../schema/container-writer';

export { DIRECTIVE_CONTAINER, DIRECTIVE_OPENER_LINE };
export const DIRECTIVE_LEAF = 'directiveLeaf';
export const DIRECTIVE_TEXT = 'directiveText';

/** What draws the generic directive kinds and every `:::` container's opener line; core can't
 *  import components, so they arrive here. */
export interface DirectiveViews {
	container: BlockView;
	leaf: BlockView;
	openerLine: BlockView;
}

export function registerDirectiveKinds(views: DirectiveViews): void {
	if (isBlockKindRegistered(DIRECTIVE_CONTAINER)) return; // idempotent for HMR / re-import
	const container = declarePluginKind(DIRECTIVE_CONTAINER);
	const leaf = declarePluginKind(DIRECTIVE_LEAF);
	const openerLine = declarePluginKind(DIRECTIVE_OPENER_LINE);
	// The container's own component styles the line, so the row kind has one look for all.
	registerTitleRowLeaf(openerLine, views.openerLine, {
		label: 'Title',
		contentStart: { range: directiveLineContentRange }
	});

	registerBlockKind(container, {
		view: views.container,
		opener: directiveContainerOpener(container, leaf),
		label: 'Directive',
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		// An opaque container has no text of its own at either edge, so both take the gap caret.
		gapEdges: 'both',
		container: { lines: COLON_LINES },
		conformanceFixture: ':::spoiler\n\nhidden\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container lines — the colon shape, written by the container writer',
			focus: { mode: 'implemented', via: 'focus walks to the opener line / first body child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container; Backspace at the body start goes to the opener line, as in any container with a title row'
			},
			undo: { mode: 'inherit-default' },
			clipboard: {
				mode: 'implemented',
				via: 'byte-slice copy; a slice touching the opener line re-emits the container around what it collected'
			},
			simOracle: { mode: 'implemented', via: 'directive e2e under the [invariant:] watcher' }
		})
	});

	registerBlockKind(leaf, {
		view: views.leaf,
		label: 'Directive',
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		contentStart: { range: directiveLineContentRange },
		keymap: DIRECTIVE_LEAF_KEYMAP,
		conformanceFixture: '::spoiler\n',
		closure: {
			roundTrip: { mode: 'inherit-default' },
			focus: { mode: 'implemented', via: 'native caret in the raw-editable contenteditable' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'not-mergeable — Backspace moves focus (mergePrev walk), never concatenates'
			},
			selectionPaint: { mode: 'implemented', via: 'measurePartialRects (raw offsets)' },
			searchPaint: {
				mode: 'implemented',
				via: 'content-range raw scanned (::name marker skipped); marks'
			},
			reorder: { mode: 'implemented', via: 'Alt+Arrow block.move keymap' },
			undo: { mode: 'inherit-default' },
			clipboard: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'directive e2e under the [invariant:] watcher' }
		}
	});
}

// ── Text tier: inline `:name[label]{attrs}` ────────────────────────────────────

/** The `:` recognizer gives this kind to the span it delimits. The widget opts into `revealSource`,
 *  so focus swaps it for its editable source. Idempotent for HMR. */
export function registerDirectiveTextKind(): void {
	if (isInlineKindDeclared(DIRECTIVE_TEXT)) return;
	const kind = declarePluginInlineKind(DIRECTIVE_TEXT);
	registerCoreInlineWidget(kind, {
		isWidget: () => true,
		draw: buildDirectiveTextWidget,
		editing: { revealSource: true }
	});
}

/** Renders the verbatim `:name[...]` source dimmed inside the shared widget shell. */
function buildDirectiveTextWidget(node: InlineNode, raw: string): HTMLElement {
	const shell = mintWidgetShell(node, 'directive-text-widget');
	shell.textContent = raw.slice(node.start, node.end);
	return shell;
}

// Enter opens a paragraph sibling, since a leaf never holds a line break; Backspace and Delete at
// an edge move focus without joining, as for any block that doesn't merge.
const DIRECTIVE_LEAF_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
];

/** The `::name` or `:::name` fence of a leaf or an opener line, with the spaces after it, is a
 *  dimmed marker prefix like a heading's `# `; a line that stops opening a fence has none. */
export function directiveLineContentRange(node: NodeView): { start: number; end: number } {
	const fence = matchDirectiveOpener(trimTrailingLineEnding(node.raw));
	if (!fence) return { start: 0, end: displayLength(node.raw) };
	const gap = /^[ \t]*/.exec(fence.info)![0].length;
	return { start: fence.colonCount + fence.name.length + gap, end: displayLength(node.raw) };
}

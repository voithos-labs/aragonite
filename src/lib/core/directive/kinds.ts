/**
 * Generic fallback kinds for the `:::name` directive primitive, so `:::anything` stays lossless
 * with no plugin installed. The container is `'opaque'`: its fence lives in the node's own
 * `raw`, not in a child, making `rebuildDirectiveContainerRaw` the single reconstruction path.
 * Imports stay core-relative because the `$lib/plugin` barrel would cycle back through core.
 */

import {
	declarePluginKind,
	declarePluginInlineKind,
	isInlineKindDeclared
} from '../../schema/plugin-kind';
import { registerBlockKind, isBlockKindRegistered } from '../../schema/block-kind-descriptor';
import { containerClosure } from '../../schema/closure';
import type { KeyBinding } from '../../schema/keybindings';
import { getPluginMetadata, type CstNode, type InlineNode } from '../nodes';
import type { ContainerBodyWrap } from '../parser';
import type { NodeView } from '../node-views';
import { displayLength, trimTrailingLineEnding, trailingLineEnding } from '../lines';
import { concatChildren as serializeChildren } from '../serializer';
import { registerInlineWidgetKind, mintWidgetShell } from '../inline/inline-widgets';
import { matchDirectiveOpener, serializeDirective } from './grammar';

export const DIRECTIVE_CONTAINER = 'directiveContainer';
export const DIRECTIVE_LEAF = 'directiveLeaf';
export const DIRECTIVE_TEXT = 'directiveText';

/** The `:::` opener and closer bracket every directive body, whatever kind the name mints. */
export const DIRECTIVE_BODY_WRAP: ContainerBodyWrap = {
	afterOpenerLine: true,
	beforeCloserLine: true
};

/** Fence bytes a container node round-trips through `rebuildDirectiveContainerRaw`. */
export interface DirectiveContainerMetadata {
	name: string;
	colonCount: number;
	info: string;
	closerColonCount: number;
	closerNewline: boolean;
	/** Authored line ending for the opener and closer chrome lines. */
	lineEnding: string;
}

export function registerDirectiveKinds(): void {
	if (isBlockKindRegistered(DIRECTIVE_CONTAINER)) return; // idempotent for HMR / re-import

	registerBlockKind(declarePluginKind(DIRECTIVE_CONTAINER), {
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		container: {
			contract: 'opaque',
			rebuildRaw: rebuildDirectiveContainerRaw,
			bodyWrap: DIRECTIVE_BODY_WRAP,
			unwrapRole: { firstChildBackspace: 'lift-first-child', middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: ':::spoiler\n\nhidden\n\n:::\n',
		closure: containerClosure({
			roundTripVia: 'container contract=opaque — rebuildDirectiveContainerRaw',
			focus: { mode: 'implemented', via: 'focus walks into the first body child' },
			mergeBackspace: {
				mode: 'implemented',
				via: 'mergeRole=container + unwrapRole (lift-first-child; default-merge)'
			},
			undo: { mode: 'inherit-default' },
			simOracle: { mode: 'implemented', via: 'directive e2e under the [invariant:] watcher' }
		})
	});

	registerBlockKind(declarePluginKind(DIRECTIVE_LEAF), {
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		getContentRange: directiveLeafContentRange,
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

/**
 * The `:` recognizer (text-recognizer.ts) stamps this kind on the span it delimits. The widget
 * opts into `revealSource`, so focus swaps the island for editable source and blur/Enter commits
 * (the shared reveal primitive in widget-interaction.ts). Idempotent for HMR.
 */
export function registerDirectiveTextKind(): void {
	if (isInlineKindDeclared(DIRECTIVE_TEXT)) return;
	const kind = declarePluginInlineKind(DIRECTIVE_TEXT);
	registerInlineWidgetKind(kind, {
		isWidget: () => true,
		buildWidget: buildDirectiveTextWidget,
		editing: { revealSource: true }
	});
}

/** Renders the verbatim `:name[...]` source dimmed inside the shared widget shell. */
function buildDirectiveTextWidget(node: InlineNode, raw: string): HTMLElement {
	const shell = mintWidgetShell('directive-text-widget', node);
	shell.textContent = raw.slice(node.start, node.end);
	return shell;
}

// Enter opens a paragraph sibling: a leaf never holds an in-line break, so the split reparses
// its empty tail. Backspace/Delete take the not-mergeable walk, moving focus without joining.
const DIRECTIVE_LEAF_KEYMAP: KeyBinding[] = [
	{ chord: 'Enter', command: 'block.split' },
	{ chord: 'Tab', command: 'block.insertTab' },
	{ chord: 'Backspace', command: 'block.mergePrev' },
	{ chord: 'Delete', command: 'block.mergeNext' },
	{ chord: 'Alt+ArrowUp', command: 'block.moveUp' },
	{ chord: 'Alt+ArrowDown', command: 'block.moveDown' }
];

// The `::name` fence is a dimmed marker prefix, on the heading marker-range mechanism. A raw
// that no longer opens a fence reparses to a paragraph first, so the null branch is a floor.
function directiveLeafContentRange(node: NodeView): { start: number; end: number } {
	const fence = matchDirectiveOpener(trimTrailingLineEnding(node.raw));
	const start = fence ? fence.colonCount + fence.name.length : 0;
	return { start, end: displayLength(node.raw) };
}

export function rebuildDirectiveContainerRaw(node: CstNode): void {
	const meta = getPluginMetadata<DirectiveContainerMetadata>(node);
	if (!meta) return;
	node.raw = serializeDirective({
		colonCount: meta.colonCount,
		name: meta.name,
		info: meta.info,
		innerPrefix: node.innerPrefix ?? '',
		body: serializeChildren(node.children ?? []),
		innerSuffix: node.innerSuffix ?? '',
		closerColonCount: meta.closerColonCount,
		closerNewline: meta.closerNewline,
		lineEnding: meta.lineEnding,
		// The parse side threads only the opener ending, so a mixed-ending directive recovers
		// the closer's from the current raw, whose last line it is.
		closerLineEnding: trailingLineEnding(node.raw)
	});
}

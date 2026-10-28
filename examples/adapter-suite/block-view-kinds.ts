// The kinds the `?block-views` page draws with each framework's own components
// (`requirements/block-views.md`): a `%% ` memo line, a `@@ ` click-to-edit label, a `:::box`
// container, a `{{name}}` inline chip, a badge on each memo giving its length, and a ```` ```note ````
// block focused whole with an edit box of its own. Each app passes its views; the grammar here is
// shared.
import {
	activateDirectives,
	containerClosure,
	createDirectiveRebuild,
	declarePluginInlineKind,
	declarePluginKind,
	declaredPluginKind,
	escalatedFenceLength,
	fenceRawWrite,
	fenceReading,
	fenceShapeOfRaw,
	getPluginMetadata,
	matchFenceInfo,
	OPENER_PRIORITIES,
	registerBlockCommand,
	definePlugin,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerDirective,
	registerInlineSyntax,
	registerInlineWidgetKind,
	scanFence,
	setPluginMetadata,
	simpleLeafClosure,
	type BlockView,
	type CstNode,
	type Decoration,
	type DecorationSource,
	type EditorPlugin,
	type InlineNode,
	type InlineWidgetComponentProps,
	type NodeView,
	type ParsedDirective,
	type PluginView
} from '@voithos-labs/aragonite/plugin';

export { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from './block-views-source';

export interface BlockViews {
	memo: BlockView;
	label: BlockView;
	box: BlockView;
	note: BlockView;
	chip: PluginView<InlineWidgetComponentProps>;
	/** Shows the `data-memo-length` attribute of the decoration it's given. */
	memoLength: PluginView<{ decoration: Decoration }>;
}

export const MEMO_LENGTH_ATTR = 'data-memo-length';

/** The chip each app's view throws on. */
export const BOOM = '{{boom}}';

export function blockViewsPlugin(views: BlockViews): EditorPlugin {
	return definePlugin({
		name: 'block-views',
		setup(ctx) {
			registerLine('memo', '%% ', 25, views.memo, 'leaf: every keystroke commits');
			registerLine(
				'label',
				'@@ ',
				26,
				views.label,
				'render-primary: one commit when the caret leaves'
			);
			registerBox(views.box);
			registerNote(views.note);
			registerChip(views.chip);
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource(memoLengths(views.memoLength));
				return () => handle.dispose();
			});
		}
	});
}

function registerChip(view: PluginView<InlineWidgetComponentProps>): void {
	const chip = declarePluginInlineKind('chip');
	registerInlineSyntax('{', (raw, pos, end): InlineNode | null => {
		if (!raw.startsWith('{{', pos)) return null;
		const close = raw.indexOf('}}', pos + 2);
		if (close < 0 || close + 2 > end || raw.slice(pos + 2, close).includes('\n')) return null;
		return { kind: chip, start: pos, end: close + 2, children: [] };
	});
	registerInlineWidgetKind(chip, {
		isWidget: () => true,
		view,
		editing: { deleteGranularity: 'atomic', onEdge: 'step-over' }
	});
}

// A badge on every top-level memo, carrying the memo's length, so an edit changes its decoration.
function memoLengths(view: PluginView<{ decoration: Decoration }>): DecorationSource {
	return {
		name: 'memo-length',
		provide: (doc) =>
			doc.children.flatMap((node, index): Decoration[] =>
				node.kind === declaredPluginKind('memo')
					? [
							{
								type: 'block',
								path: [index],
								attrs: { [MEMO_LENGTH_ATTR]: String(node.raw.trimEnd().length) },
								badge: { view }
							}
						]
					: []
			)
	};
}

function registerLine(
	name: string,
	marker: string,
	priority: number,
	view: BlockView,
	undo: string
): void {
	const kind = declarePluginKind(name);
	registerBlockKind(kind, {
		view,
		opener: {
			priority,
			interruptsParagraph: (text) => text.startsWith(marker),
			tryOpen: (ctx) =>
				ctx.line.text.startsWith(marker)
					? { node: { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw }, consumed: 1 }
					: null
		},
		gapEdges: 'none',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		conformanceFixture: `${marker}text\n`,
		closure: simpleLeafClosure({
			focus: { mode: 'implemented', via: 'the leaf surface' },
			searchPaint: { mode: 'inherit-default' },
			undo: { mode: 'implemented', via: undo },
			simOracle: { mode: 'inherit-default' }
		})
	});
}

interface BoxMetadata {
	colonCount: number;
	closerColonCount: number;
	closerNewline: boolean;
	lineEnding: string;
}

function boxFromDirective(parsed: ParsedDirective): CstNode {
	const node: CstNode = {
		kind: declaredPluginKind('box'),
		leadingTrivia: parsed.leadingTrivia,
		raw: parsed.raw,
		innerPrefix: parsed.body?.prefix ?? '',
		children: parsed.body?.children ?? [],
		innerSuffix: parsed.body?.suffix ?? ''
	};
	setPluginMetadata<BoxMetadata>(node, {
		colonCount: parsed.fence.colonCount,
		closerColonCount: parsed.closerColonCount,
		closerNewline: parsed.closerNewline,
		lineEnding: parsed.lineEnding
	});
	return node;
}

function registerBox(view: BlockView): void {
	activateDirectives();
	const box = declarePluginKind('box');
	registerDirective('container', 'box', { kind: box, fromDirective: boxFromDirective });
	registerBlockKind(box, {
		view,
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		gapEdges: 'both',
		container: {
			contract: 'opaque',
			rebuildRaw: createDirectiveRebuild(),
			bodyWrap: DIRECTIVE_BODY_WRAP
		},
		conformanceFixture: ':::box Title\nbody\n:::\n',
		closure: containerClosure({
			roundTripVia: 'createDirectiveRebuild',
			focus: { mode: 'implemented', via: 'focus walks to the opener line' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: { mode: 'implemented', via: 'children commit as ordinary blocks' },
			simOracle: { mode: 'inherit-default' },
			clipboard: { mode: 'implemented', via: 'byte-slice copy' }
		})
	});
}

// ── The note block ───────────────────────────────────────────────────────────

/** The note's text and its fence, everything `rebuildNoteRaw` writes back. */
export interface NoteMetadata {
	text: string;
	indent: string;
	marker: '`' | '~';
	fenceLength: number;
	infoRaw: string;
	lineEnding: string;
	closerRaw: string;
}

/** What the note's `note.edit` command (Mod+M) reaches through the view's command hooks. */
export interface NoteHooks {
	openEdit(): void;
}

export const noteText = (node: NodeView): string =>
	getPluginMetadata<NoteMetadata>(node)?.text ?? '';

function rebuildNoteRaw(node: CstNode): void {
	const meta = getPluginMetadata<NoteMetadata>(node);
	if (!meta) return;
	const length = escalatedFenceLength(meta.text, meta.marker, meta.fenceLength);
	const fence = meta.marker.repeat(length);
	// An unterminated note has no closer and gains none; one a longer fence outgrows is rewritten.
	const closer = !meta.closerRaw
		? ''
		: length > meta.fenceLength
			? fence + meta.lineEnding
			: meta.closerRaw;
	node.raw = meta.indent + fence + meta.infoRaw + meta.lineEnding + meta.text + closer;
}

function registerNote(view: BlockView): void {
	const note = declarePluginKind('note');
	const matchNote = matchFenceInfo('note');
	const edit = registerBlockCommand(note, 'note.edit', (ctx) => {
		const hooks = ctx.hooks as NoteHooks | undefined;
		if (!hooks) return false;
		hooks.openEdit();
		return true;
	});
	registerBlockKind(note, {
		view,
		opener: {
			priority: OPENER_PRIORITIES.fencedCode - 4,
			interruptsParagraph: (line) => matchNote(line) !== null,
			readingNotFinal: fenceReading,
			tryOpen(ctx) {
				const fence = matchNote(ctx.line.text);
				if (!fence) return null;
				const scan = scanFence(ctx, fence);
				const node: CstNode = {
					kind: note,
					leadingTrivia: ctx.leadingTrivia,
					raw: '',
					children: []
				};
				setPluginMetadata<NoteMetadata>(node, {
					text: scan.body,
					indent: fence.indent,
					marker: fence.marker,
					fenceLength: fence.length,
					infoRaw: fence.infoRaw,
					lineEnding: ctx.line.lineEnding,
					closerRaw: scan.closer === -1 ? '' : ctx.lines[scan.closer].raw
				});
				rebuildNoteRaw(node);
				return { node, consumed: scan.consumed };
			}
		},
		label: 'Note',
		mergeRole: 'not-mergeable',
		editable: true,
		supportsInline: false,
		blockFocus: 'whole-block',
		gapEdges: 'before',
		container: { contract: 'opaque', rebuildRaw: rebuildNoteRaw },
		rawWrite: fenceRawWrite(fenceShapeOfRaw),
		keymap: [{ chord: 'Mod+M', command: edit }],
		conformanceFixture: '```note\nhello\n```\n',
		closure: {
			roundTrip: { mode: 'implemented', via: 'container contract=opaque, rebuildNoteRaw' },
			focus: {
				mode: 'implemented',
				via: 'blockFocus=whole-block, the view attaches its focus element'
			},
			mergeBackspace: { mode: 'implemented', via: 'blockFocus=whole-block' },
			selectionPaint: { mode: 'implemented', via: 'whole-block cover rect' },
			searchPaint: { mode: 'implemented', via: 'raw scans as a leaf' },
			reorder: { mode: 'implemented', via: 'whole-block reorder' },
			undo: { mode: 'implemented', via: 'updateOwnMetadata, one entry per edit' },
			clipboard: { mode: 'implemented', via: 'focused-block copy and cut' },
			simOracle: { mode: 'inherit-default' }
		}
	});
}

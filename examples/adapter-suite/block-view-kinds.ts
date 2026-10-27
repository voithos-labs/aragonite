// The kinds the `?block-views` page draws with each framework's own components
// (`requirements/block-views.md`): a `%% ` memo line, a `@@ ` click-to-edit label, a `:::box`
// container, a `{{name}}` inline chip, and a badge on each memo giving its length. Each app passes
// its views; the grammar here is shared.
import {
	activateDirectives,
	chromeChild,
	containerClosure,
	createDirectiveRebuild,
	declarePluginInlineKind,
	declarePluginKind,
	declaredPluginKind,
	definePlugin,
	DIRECTIVE_BODY_WRAP,
	registerBlockKind,
	registerChromeLeaf,
	registerDirective,
	registerInlineSyntax,
	registerInlineWidgetKind,
	setPluginMetadata,
	simpleLeafClosure,
	trimWhitespace,
	type BlockView,
	type CstNode,
	type Decoration,
	type DecorationSource,
	type EditorPlugin,
	type InlineNode,
	type InlineWidgetComponentProps,
	type ParsedDirective,
	type PluginView
} from '@voithos-labs/aragonite/plugin';

export { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from './block-views-source';

export interface BlockViews {
	memo: BlockView;
	label: BlockView;
	box: BlockView;
	chip: PluginView<InlineWidgetComponentProps>;
	/** Shows the `data-memo-length` attribute of the decoration it's given. */
	memoLength: PluginView<{ decoration: Decoration }>;
}

export const MEMO_LENGTH_ATTR = 'data-memo-length';

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
		children: [
			chromeChild(declaredPluginKind('box-title'), trimWhitespace(parsed.fence.info)),
			...(parsed.body?.children ?? [])
		],
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
	const title = declarePluginKind('box-title');
	registerDirective('container', 'box', { kind: box, fromDirective: boxFromDirective });
	registerBlockKind(box, {
		view,
		mergeRole: 'container',
		editable: true,
		supportsInline: false,
		gapEdges: 'both',
		container: {
			contract: 'opaque',
			rebuildRaw: createDirectiveRebuild<BoxMetadata>(() => 'box'),
			bodyWrap: DIRECTIVE_BODY_WRAP,
			reservedChrome: { kind: title },
			unwrapRole: { middleChildBackspace: 'default-merge' }
		},
		conformanceFixture: ':::box Title\nbody\n:::\n',
		closure: containerClosure({
			roundTripVia: 'createDirectiveRebuild',
			focus: { mode: 'implemented', via: 'focus walks to the title row' },
			mergeBackspace: { mode: 'implemented', via: 'mergeRole=container + unwrapRole' },
			undo: { mode: 'implemented', via: 'children commit as ordinary blocks' },
			simOracle: { mode: 'inherit-default' },
			clipboard: { mode: 'implemented', via: 'byte-slice copy' }
		})
	});
	registerChromeLeaf(title, { label: 'Box title', blockClass: 'box-title' });
}

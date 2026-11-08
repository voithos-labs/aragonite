// The block types the `?block-views` page draws with each framework's own components
// (`requirements/block-views.md`): a `%% ` memo line, a `@@ ` click-to-edit label, a `%> ` box
// holding blocks, a ```` ```note ```` block focused whole with an edit box of its own, and a
// `!! d6` die the component draws whole; beside them a `{{name}}` inline chip and a badge on each
// memo giving its length. Each app passes its draws; the grammar here is shared.
import {
	container,
	declarePluginInlineKind,
	definePlugin,
	fencedBlock,
	lineBlock,
	registerInlineSyntax,
	registerInlineWidgetKind,
	type Block,
	type BlockType,
	type BoxDrawContext,
	type ContainerDrawContext,
	type Decoration,
	type DrawContext,
	type DecorationSource,
	type Drawn,
	type InlineNode,
	type InlineWidgetComponentProps,
	type PluginView,
	type TextDrawContext
} from '@voithos-labs/aragonite/plugin';

export { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from './block-views-source';

type Draw<C extends DrawContext> = (block: Block<never>, ctx: C) => Drawn<never, C>;

export interface BlockViews {
	memo: Draw<TextDrawContext>;
	label: Draw<TextDrawContext>;
	box: Draw<ContainerDrawContext>;
	note: Draw<BoxDrawContext>;
	dice: Draw<BoxDrawContext>;
	chip: PluginView<InlineWidgetComponentProps>;
	/** Shows the `data-memo-length` attribute of the decoration it's given. */
	memoLength: PluginView<{ decoration: Decoration }>;
}

export const MEMO_LENGTH_ATTR = 'data-memo-length';

/** The chip each app's view throws on. */
export const BOOM = '{{boom}}';

/** The die each app's view throws on. */
export const DICE_BOOM = '!! boom';

/** A die's sides, from its `!! d<sides>` line. */
export const diceSides = (block: Block<never>): number =>
	Number(/d(\d+)/.exec(block.text)?.[1] ?? 6);

/** The note's text written back into its fence, at the note's bytes as they are now. */
export function saveNote(block: Block<never>, ctx: BoxDrawContext, text: string): void {
	const fence = '```note\n' + text + '\n```\n';
	void ctx.editor.edit().replace({ from: block.from, to: block.to }, fence).commit();
}

/** The page's plugins: its block types, then its chip and the badges on its memos. */
export function blockViewsPlugins(views: BlockViews) {
	const insert = { none: 'an adapter suite block' };
	const memo = lineBlock({
		name: 'memo',
		label: 'Memo',
		match: /^%% (?<text>.*)$/,
		sample: '%% a memo',
		insert,
		interrupts: true,
		edit: 'text',
		draw: views.memo
	});
	const blocks = definePlugin({
		name: 'block-views',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				memo,
				lineBlock({
					name: 'label',
					label: 'Label',
					match: /^@@ (?<text>.*)$/,
					sample: '@@ a label',
					insert,
					interrupts: true,
					edit: 'source',
					draw: views.label
				}),
				container({
					name: 'box',
					label: 'Box',
					lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
					sample: '%> inside the box',
					insert,
					draw: views.box
				}),
				fencedBlock({
					name: 'note',
					label: 'Note',
					fence: { info: 'note' },
					sample: '```note\nhello\n```',
					insert,
					edit: 'box',
					draw: (block, ctx) => focusBack(views.note(block, ctx))
				}),
				lineBlock<never>({
					name: 'dice',
					label: 'Die',
					match: /^!! .*$/,
					sample: '!! d6',
					insert,
					interrupts: true,
					edit: 'box',
					draw: views.dice
				})
			]
		})
	});
	const inline = definePlugin({
		name: 'block-views-inline',
		setup(ctx) {
			registerChip(views.chip);
			ctx.onEditor((editor) => {
				const handle = editor.decorations.addSource(memoLengths(memo, views.memoLength));
				return () => handle.dispose();
			});
		}
	});
	return [blocks, inline];
}

// Escape in the note's edit box hands focus to the note's element, which gives it to the editor:
// the note is focused whole again.
function focusBack(drawn: Drawn<never, BoxDrawContext>): Drawn<never, BoxDrawContext> {
	drawn.dom.tabIndex = -1;
	drawn.dom.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') drawn.dom.focus();
	});
	return drawn;
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
function memoLengths(
	memo: BlockType<never>,
	view: PluginView<{ decoration: Decoration }>
): DecorationSource {
	return {
		name: 'memo-length',
		provide: (doc) =>
			doc.children.flatMap((node, index): Decoration[] =>
				node.kind === memo.name
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

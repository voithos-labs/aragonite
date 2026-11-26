// The block types the `?block-views` page draws with each framework's own components
// (`requirements/block-views.md`): a `%% ` memo line, a `@@ ` click-to-edit label, a `%> ` box
// holding blocks, a ```` ```note ```` block focused whole with an edit box of its own, and a
// `!! d6` die the component draws whole; beside them a `{{name}}` inline chip and a badge on each
// memo giving its length. Each app passes its draws; the grammar here is shared.
import {
	container,
	definePlugin,
	fencedBlock,
	inline,
	lineBlock,
	type Block,
	type BlockPaint,
	type BoxDrawContext,
	type ContainerDrawContext,
	type DrawContext,
	type Drawn,
	type PluginView,
	type TextDrawContext,
	type WidgetProps
} from '@voithos-labs/aragonite/plugin';

export { BLOCK_VIEWS_SOURCE, LONG_SOURCE } from './block-views-source';

type Draw<C extends DrawContext> = (block: Block<never>, ctx: C) => Drawn<never, C>;

export interface BlockViews {
	memo: Draw<TextDrawContext>;
	label: Draw<TextDrawContext>;
	box: Draw<ContainerDrawContext>;
	note: Draw<BoxDrawContext>;
	dice: Draw<BoxDrawContext>;
	chip: PluginView<WidgetProps<ChipData>>;
	/** Shows the `data-memo-length` attribute of the paint it's given. */
	memoLength: PluginView<{ paint: BlockPaint }>;
}

export const MEMO_LENGTH_ATTR = 'data-memo-length';

/** A chip's name, between its braces. */
export interface ChipData {
	name: string;
}

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

/** The page's plugins: its block types, its chip and the badges on its memos. */
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
	const plugin = definePlugin({
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
					draw: views.note
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
			],
			inlines: [chip(views.chip)],
			// A badge on every top-level memo, carrying the memo's length, so an edit changes its paint.
			paint: (block): BlockPaint[] =>
				block.is(memo) && block.parent === null
					? [
							{
								type: 'block',
								attrs: { [MEMO_LENGTH_ATTR]: String(block.text.trimEnd().length) },
								badge: views.memoLength
							}
						]
					: []
		})
	});
	return [plugin];
}

// `{{name}}` on one line, drawn whole by the app's view.
const chip = (view: PluginView<WidgetProps<ChipData>>) =>
	inline<ChipData>({
		name: 'chip',
		label: 'Chip',
		prefix: '{',
		sample: '{{pebble}}',
		match: /\{\{[^\n]*?\}\}/,
		read: (match) => ({ name: match[0].slice(2, -2) }),
		widget: { delete: 'whole', arrows: 'over', click: 'none' },
		draw: view
	});

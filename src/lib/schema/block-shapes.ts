/**
 * What a plugin writes to make a block type, and how the editor derives everything else from it:
 * the facts every editor system reads (merging, focus, gap carets, inline reading) follow from
 * the shape and its `role`, so an author can't declare two answers that disagree.
 */
import { setPluginMetadata, type CstNode, type PluginBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { trimTrailingLineEnding } from '../core/lines';
import type { MenuIconName } from '../menu-icons';
import type { BlockOpener } from './block-openers';
import type { BuiltinRegistration } from './block-kind-descriptor';
import { simpleLeafClosure } from './closure';
import { OPENER_PRIORITIES } from './opener-priorities';
import { isValidPluginName } from './plugin-name';
import { makingOf } from './block-type';
import type { BlockType } from './plugin-unit';
import { blockOf, type Block } from './doc-view';

// ── Specs ────────────────────────────────────────────────────────────────────

/** What every block type answers, whatever its shape. */
export interface BlockCommon<D> {
	/** Lowercase letters, digits and hyphens; an editor qualifies it with the plugin's name. */
	name: string;
	/** What a screen reader and the block menu call it. */
	label: string;
	icon?: MenuIconName;
	/** Markdown holding this block, which the published checks parse and drive. */
	sample: string | readonly string[];
	/** `prose` merges with its neighbours and has no drag handle; an `object` is picked up whole.
	 *  Default `prose` for a text block drawn as text, `object` otherwise. */
	role?: 'prose' | 'object';
	/** Its first line may cut a paragraph short, as a heading's does. */
	interrupts?: boolean;
	/** Block types tried after this one, by reference, so its place can't drift. */
	before?: BlockType<unknown> | readonly BlockType<unknown>[];
	/** The height to hold, in pixels, before the block is drawn. */
	height?(block: Block<NoInfer<D>>): number;
}

/** What a block holding text answers besides. */
export interface LeafCommon<D> extends BlockCommon<D> {
	/** `source`, the default: a caret edits its text. `box`: no caret enters; it's focused whole. */
	edit?: 'source' | 'box';
	/** Its text reads inline Markdown; default `literal`. */
	body?: 'markdown' | 'literal';
}

/** A block that's exactly one line, matched whole by `match`; a `text` named group is the text the
 *  author writes, the rest its marker. Data read from the line comes with the writer that puts it back. */
export type LineBlockSpec<D> = LeafCommon<D> & { match: RegExp } & (
		| { data?: never; write?: never }
		| {
				data(match: RegExpExecArray): D;
				/** The line for this data around `text`, the `text` group's content. */
				write(data: D, text: string): string;
		  }
	);

// ── Derived facts ────────────────────────────────────────────────────────────

const UNPLACED = 1000;

/** Where a block type's opener sits: just ahead of the earliest type it names in `before`, else
 *  after every built-in. */
export function priorityBefore(before: BlockCommon<unknown>['before']): number {
	const named = before === undefined ? [] : Array.isArray(before) ? before : [before];
	let earliest = UNPLACED + 1;
	for (const type of named as readonly BlockType<unknown>[]) {
		const place =
			makingOf(type)?.priority ??
			(OPENER_PRIORITIES as Record<string, number | undefined>)[type.name] ??
			UNPLACED;
		earliest = Math.min(earliest, place);
	}
	return earliest - 1;
}

/** The registration a text or box leaf derives from its spec: `range` is its text in its bytes. */
export function leafRegistration(
	spec: LeafCommon<unknown>,
	range: ((node: NodeView) => { start: number; end: number }) | null,
	drawn: boolean
): BuiltinRegistration {
	const box = spec.edit === 'box';
	const role = spec.role ?? (box || drawn ? 'object' : 'prose');
	const shared = {
		label: spec.label,
		editable: true,
		pageRole: role,
		mergeRole: role === 'prose' ? ('prose-absorber' as const) : ('not-mergeable' as const),
		gapEdges: box || drawn ? ('both' as const) : ('none' as const),
		...fixtureOf(spec.sample),
		...(spec.height ? { estimateHeight: heightEstimate(spec.height) } : {}),
		closure: LEAF_CLOSURE
	};
	if (box) return { ...shared, blockFocus: 'whole-block', supportsInline: false };
	return {
		...shared,
		supportsInline: spec.body === 'markdown',
		...(range ? { contentStart: { range, backspace: 'demote-first' as const } } : {})
	};
}

// ── Line blocks ──────────────────────────────────────────────────────────────

/** The opener and text range of a line block. */
export function lineShape(spec: LineBlockSpec<unknown>, priority: number) {
	// `d` for the `text` group's indices; `g` and `y` would carry a position between calls.
	const flags = spec.match.flags.replace(/[gyd]/g, '') + 'd';
	const pattern = new RegExp(spec.match.source, flags);
	const wholeLine = (text: string): RegExpExecArray | null => {
		const match = pattern.exec(text);
		return match && match.index === 0 && match[0].length === text.length ? match : null;
	};
	const hasText = /\(\?<text>/.test(spec.match.source);
	return {
		range: hasText
			? (node: NodeView) => {
					const text = trimTrailingLineEnding(node.raw);
					const at = wholeLine(text)?.indices?.groups?.text;
					return at ? { start: at[0], end: at[1] } : { start: text.length, end: text.length };
				}
			: null,
		opener(kind: PluginBlockKind): BlockOpener {
			return {
				priority,
				interruptsParagraph: spec.interrupts ? (text) => wholeLine(text) !== null : false,
				tryOpen(ctx) {
					const match = wholeLine(ctx.line.text);
					if (!match) return null;
					const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
					if (spec.data) setPluginMetadata(node, spec.data(match));
					return { node, consumed: 1 };
				}
			};
		}
	};
}

/** Throws for a local name an editor couldn't qualify. */
export function checkLocalName(maker: string, name: string): void {
	if (!isValidPluginName(name)) {
		throw new Error(
			`${maker}: invalid name "${name}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
}

// ── Internal ─────────────────────────────────────────────────────────────────

// Every leaf a maker builds answers the editor's systems the same way, through the editor's text.
const LEAF_CLOSURE = simpleLeafClosure({
	focus: { mode: 'implemented', via: 'derived from the block type' },
	searchPaint: { mode: 'implemented', via: 'derived from the block type' },
	undo: { mode: 'implemented', via: 'derived from the block type' },
	simOracle: { mode: 'inherit-default' }
});

// A JavaScript author can leave the sample out; the published checks report that.
function fixtureOf(sample: string | readonly string[] | undefined) {
	const first = typeof sample === 'string' ? sample : sample?.[0];
	if (first === undefined) return {};
	return { conformanceFixture: first.endsWith('\n') ? first : `${first}\n` };
}

function heightEstimate(height: (block: Block<never>) => number) {
	// A type named by the kind is enough here: `is` compares names.
	return (node: NodeView) => height(blockOf<never>(node, (kind) => ({ name: kind, label: kind })));
}

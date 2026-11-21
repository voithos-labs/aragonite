/**
 * What a plugin writes to make a block type, and how the editor derives everything else from it:
 * the facts every editor system reads (merging, focus, gap carets, inline reading) follow from
 * the shape and its `role`, so an author can't declare two answers that disagree.
 */
import { setPluginMetadata, type CstNode, type PluginBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { trimTrailingLineEnding } from '../core/lines';
import type { Icon, MenuIconName } from '../menu-icons';
import type { Chord, Command } from './plugin-command';
import type { InsertRow } from './insert-catalogue';
import type { BlockOpener } from './block-openers';
import type { BuiltinRegistration, WriteRule } from './block-kind-descriptor';
import type { BlockCompleter } from './block-completions';
import { pluginTextKeymap } from './built-in-descriptors';
import { OPENER_PRIORITIES } from './opener-priorities';
import { isValidPluginName } from './plugin-name';
import { makingOf } from './block-type';
import type { BlockType } from './plugin-unit';
import { blockOf, DETACHED_READING, type Block } from './doc-view';
import {
	drawnCaretAt,
	type BoxDrawContext,
	type Drawing,
	type Drawn,
	type TextDrawContext
} from './drawing';
import type { LineEnding } from '../core/lines';

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
	/** Its row in the insert menus, listed as `plugin/name`, or why it has none. */
	insert: BlockInsert;
	/** `prose` merges with its neighbours and has no drag handle; an `object` is picked up whole.
	 *  Default `prose` for one line of text drawn as text and for a marked container. */
	role?: 'prose' | 'object';
	/** Its first line may cut a paragraph short, as a heading's does. */
	interrupts?: boolean;
	/** Block types tried after this one, by reference, so its place can't drift. */
	before?: BlockType<unknown> | readonly BlockType<unknown>[];
	/** The height to hold, in pixels, before the block is drawn. */
	height?(block: Block<NoInfer<D>>): number;
	/** A line typed, or entered, that this block type completes into its full form. */
	complete?: Completion;
	/** Keys that act in this block type and the blocks it holds, each running its command on the
	 *  block; a host rebinds one with `keybindings: [{ kind: thisType, … }]`. */
	chords?: { readonly [K in BlockKey]?: Command<Block<NoInfer<D>>> };
	/** Rows of the block's own menu. */
	actions?: readonly BlockAction<NoInfer<D>>[];
}

/** A key a block type takes: a chord, or a bare key the editor binds in text blocks itself. A key a
 *  block inside binds runs there first. */
export type BlockKey = Chord | 'Enter' | 'Backspace' | 'Delete';

/** A row of a block type's own menu: runs its command on the block the menu opened over. */
export interface BlockAction<D> {
	label: string;
	icon?: Icon;
	/** Its `when` greys the row. */
	command: Command<Block<D>>;
}

/** A block type's insert row, its id the block type's own name; or why it can't be inserted. */
export type BlockInsert = Omit<InsertRow, 'id'> | { none: string };

/** A line completed into a block type's full lines, written with the document's line ending as one
 *  undo step; a completion that wouldn't read back as this block type is refused. */
export interface Completion {
	on: 'typed' | 'enter' | 'both';
	line: RegExp;
	/** The lines to write and where the caret lands, or null to leave the line. */
	complete(match: RegExpExecArray): {
		lines: readonly string[];
		caret: { line: number; col: number };
	} | null;
}

/** What a block holding text answers besides, and how it draws. */
export type LeafCommon<D> = BlockCommon<D> & {
	/** Its text reads inline Markdown; default `literal`. */
	body?: 'markdown' | 'literal';
} & LeafDraw<D>;

/**
 * How a leaf draws. `text`: its text is always the editable view and every keystroke writes it.
 * `source`: a picture until the caret comes in, its text then, written once as it leaves. `box`: no
 * caret enters; it's focused whole. Default `text` without `draw`, `source` with it.
 */
export type LeafDraw<D> =
	| {
			edit?: 'text' | 'source';
			draw?(block: Block<NoInfer<D>>, ctx: TextDrawContext): Drawn<NoInfer<D>, TextDrawContext>;
			/** Draws the shown text as DOM (fence lines to hide, highlight tokens); the fragment's
			 *  `textContent` must stay `text`. */
			renderSource?(text: string): DocumentFragment;
			/** The text as the block type keeps it, asked on show and after each edit, with the caret
			 *  carried; an added line takes `lineEnding`. Null keeps it. */
			reshapeSource?(
				text: string,
				caret: number,
				lineEnding: LineEnding
			): { text: string; caret: number } | null;
	  }
	| {
			edit: 'box';
			draw(block: Block<NoInfer<D>>, ctx: BoxDrawContext): Drawn<NoInfer<D>, BoxDrawContext>;
	  };

/** A block that's exactly one line, matched whole by `match`; a `text` named group is the text the
 *  author writes, the rest its marker. Data read from the line comes with the writer that puts it back. */
export type LineBlockSpec<D> = LeafCommon<D> &
	(
		| ({ match: RegExp } & LineData<D>)
		| {
				/** For a line a regex can't read: the text's range in the line (null for a line with no
				 *  text of its own) and its data, or null for a line that isn't this block type. */
				match(line: string): { text: readonly [number, number] | null; data?: D } | null;
				data?: never;
				write?(data: D, text: string): string;
		  }
	);

/** Data read from the line, with the writer that puts it back around the text. */
type LineData<D> =
	| { data?: never; write?: never }
	| { data(match: RegExpExecArray): D; write(data: D, text: string): string };

/** A block opened by one line and closed by a later one: a code fence with one of these info
 *  strings, or its own opening line and closing line. */
export type FencedBlockSpec = LeafCommon<never> & { fence: Fence | readonly Fence[] };

/** One spelling of a fenced block. A body line that would close a fixed closer early is passed to
 *  `escape`; without it, the block ends there. */
export type Fence =
	| { info: string | readonly string[] }
	| {
			open: RegExp;
			close: string | ((open: RegExpExecArray) => string);
			escape?(bodyLine: string): string;
	  };

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

/** What a leaf's shape says about its text: where it sits in its bytes, whether it spans lines (so
 *  Enter types a line break), and the rule that keeps a write of its bytes legal. */
export interface LeafText {
	range: ((node: NodeView) => { start: number; end: number }) | null;
	multiLine: boolean;
	writes?: WriteRule;
}

/** The registration a text or box leaf derives from its spec and its shape. */
export function leafRegistration(spec: LeafCommon<unknown>, text: LeafText): BuiltinRegistration {
	const { range, multiLine, writes } = text;
	const edit = editOf(spec);
	const box = edit === 'box';
	// Plain one-line text reads as prose, as a heading does; a fenced text reads as code.
	const role = spec.role ?? (edit === 'text' && !spec.draw && !multiLine ? 'prose' : 'object');
	const shared = {
		label: spec.label,
		editable: true,
		pageRole: role,
		mergeRole: role === 'prose' ? ('prose-absorber' as const) : ('not-mergeable' as const),
		// An edge where Enter already makes a paragraph takes no gap caret: a one-line text splits
		// at either end, a box focused whole opens one below.
		gapEdges: box ? ('before' as const) : multiLine ? ('both' as const) : ('none' as const),
		...fixtureOf(spec.sample),
		...(spec.height ? { estimateHeight: heightEstimate(spec.height) } : {}),
		...(writes ? { rawWrite: writes } : {})
	};
	if (box) return { ...shared, blockFocus: 'whole-block', supportsInline: false };
	return {
		...shared,
		supportsInline: spec.body === 'markdown',
		keymap: pluginTextKeymap(spec.body === 'markdown', multiLine),
		// A one-line marker drops first, as `## ` does; a fence's lines aren't a marker to drop.
		...(range
			? { contentStart: multiLine ? { range } : { range, backspace: 'demote-first' as const } }
			: {}),
		...(edit === 'source'
			? { textPosition: 'while-source-shows' as const, caretTargetAtPoint: drawnCaretAt }
			: {})
	};
}

/** What the draw host runs for a leaf with a `draw`; null for one drawn as plain text. */
export function leafDrawing(
	spec: LeafDraw<unknown>,
	type: () => BlockType<unknown>,
	singleLine: boolean
): Drawing | null {
	if (!spec.draw) return null;
	const draw = spec.draw as Drawing['draw'];
	if (spec.edit === 'box') return { type, edit: 'box', singleLine, draw };
	const { renderSource, reshapeSource } = spec;
	return { type, edit: editOf(spec), singleLine, draw, renderSource, reshapeSource };
}

/** The completer a block type's `complete` makes, refusing what `claims` wouldn't read as it. */
export function completerOf(
	completion: Completion | undefined,
	claims: (lines: readonly string[]) => boolean
): BlockCompleter | null {
	if (!completion) return null;
	const pattern = new RegExp(completion.line.source, completion.line.flags.replace(/[gy]/g, ''));
	return {
		onType: completion.on !== 'enter',
		onEnter: completion.on !== 'typed',
		tryComplete(line) {
			const match = pattern.exec(line);
			if (!match || match.index !== 0 || match[0].length !== line.length) return null;
			const made = completion.complete(match);
			if (!made || !claims(made.lines)) return null;
			return {
				lines: [...made.lines],
				caret: { path: [], line: made.caret.line, column: made.caret.col }
			};
		}
	};
}

/** How a leaf edits, its default read off whether it draws. */
export function editOf(spec: LeafDraw<unknown>): 'text' | 'source' | 'box' {
	return spec.edit ?? (spec.draw ? 'source' : 'text');
}

// ── Line blocks ──────────────────────────────────────────────────────────────

/** The opener and text range of a line block. */
export function lineShape(spec: LineBlockSpec<unknown>, priority: number) {
	const wholeLine = lineReader(spec);
	const hasText = typeof spec.match === 'function' || /\(\?<text>/.test(spec.match.source);
	const { write } = spec as { write?(data: unknown, text: string): string };
	return {
		/** The line rewritten around its text by `write`; null when it wouldn't read back as the type. */
		writeData: write
			? (node: NodeView, data: unknown): string | null => {
					const line = trimTrailingLineEnding(node.raw);
					const at = wholeLine(line)?.text;
					const written = write(data, at ? line.slice(at[0], at[1]) : '');
					return wholeLine(written) ? written + node.raw.slice(line.length) : null;
				}
			: undefined,
		range: hasText
			? (node: NodeView) => {
					const text = trimTrailingLineEnding(node.raw);
					const at = wholeLine(text)?.text;
					return at ? { start: at[0], end: at[1] } : { start: text.length, end: text.length };
				}
			: null,
		/** Lines a completion wrote: exactly one, matched whole. */
		claims: (lines: readonly string[]) => lines.length === 1 && wholeLine(lines[0]) !== null,
		opener(kind: PluginBlockKind): BlockOpener {
			return {
				priority,
				interruptsParagraph: spec.interrupts ? (text) => wholeLine(text) !== null : false,
				tryOpen(ctx) {
					const match = wholeLine(ctx.line.text);
					if (!match) return null;
					const node: CstNode = { kind, leadingTrivia: ctx.leadingTrivia, raw: ctx.line.raw };
					const data = match.data();
					if (data !== undefined) setPluginMetadata(node, data);
					return { node, consumed: 1 };
				}
			};
		}
	};
}

/** A line block's matcher, a regex or a function, read as the text's range and the line's data. */
function lineReader(spec: LineBlockSpec<unknown>) {
	const { match, data } = spec as {
		match:
			| RegExp
			| ((line: string) => { text: readonly [number, number] | null; data?: unknown } | null);
		data?(read: RegExpExecArray): unknown;
	};
	if (typeof match === 'function') {
		return (line: string) => {
			const found = match(line);
			return found && { text: found.text, data: () => found.data };
		};
	}
	// `d` for the `text` group's indices; `g` and `y` would carry a position between calls.
	const pattern = new RegExp(match.source, match.flags.replace(/[gyd]/g, '') + 'd');
	return (line: string) => {
		const found = pattern.exec(line);
		if (!found || found.index !== 0 || found[0].length !== line.length) return null;
		return { text: found.indices?.groups?.text ?? null, data: () => data?.(found) };
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

/** A block type's first sample as the checks' fixture; a JavaScript author can leave it out, which
 *  the published checks report. */
export function fixtureOf(sample: string | readonly string[] | undefined) {
	const first = typeof sample === 'string' ? sample : sample?.[0];
	if (first === undefined) return {};
	return { conformanceFixture: first.endsWith('\n') ? first : `${first}\n` };
}

export function heightEstimate(height: (block: Block<never>) => number) {
	// A type named by the kind is enough here: `is` compares names.
	return (node: NodeView) => height(blockOf<never>(node, DETACHED_READING));
}

/**
 * A plugin's inline construct as an editor installs it. `inline(...)` (`inline-maker.ts`) builds
 * everything the construct needs when it's called; an editor running the plugin names it after
 * the plugin (`wikilinks/note`), asks its claim from the editor's own inline table and keeps its
 * drawing on the editor's grammar, so another editor on the page reads the same bytes without it.
 */
import type { AnyInlineKind, InlineNode, PluginInlineKind } from '../core/nodes';
import type { InlineHandler } from '../core/inline/scan/plugin-syntax';
import type { WidgetEntry } from '../core/inline/inline-widgets';
import type { Mode } from '../presentation-mode';
import type { Block, InlineType } from './doc-view';
import type { Contribution, Editor, InstalledPlugin, PluginError } from './plugin-unit';
import { qualifiedName } from './plugin-name';
import { claimCommand, type Command } from './plugin-command';
import type { AnyCommandId } from './command-id';
import {
	getInlineMarkPolicy,
	holdInlineConstructPolicy,
	type InlineConstructPolicy
} from './inline-construct-policy';

// ── Public API ───────────────────────────────────────────────────────────────

/** An inline construct as a plugin lists it in `Contribution.inlines`: `name` is its kind, qualified
 *  by its plugin's name once an editor runs the plugin. */
export interface Inline<D = unknown> extends InlineType {
	readonly name: string;
	readonly label: string;
	readonly '~data'?: D;
}

interface InlineCommon<D> {
	/** Lowercase letters, digits and hyphens. */
	name: string;
	label: string;
	/** What every claim starts with: one character, or two or more where the first is one the editor
	 *  reads itself (`[[`, `![[`). */
	prefix: string;
	/** Bytes the construct reads, for the published checks. */
	sample: string | readonly string[];
	/** Constructs on the same character this one is tried after; any construct is tried before the
	 *  editor's own reading of its character. */
	after?: InlineType | readonly InlineType[];
	/** Typing the one-character prefix writes a second one after the caret. */
	pair?: boolean;
	/** A cut inside a claim (Enter, a paste) moves to its nearer edge, or cuts its bytes where it
	 *  falls. Default `'whole'`. */
	split?: 'whole' | 'plain';
	/** `D`'s witness for a type check; never read. */
	readonly '~data'?: D;
}

/** A regex matched at the prefix (made sticky); `read` turns its match into the claim's data, null
 *  to leave the bytes to the editor. */
export interface RegexMatcher<D> {
	match: RegExp;
	read(match: RegExpExecArray): D | null;
}

/** For a match a regex would make slow: where the claim at `at` ends (at most `end`), or -1 for
 *  none; `read` gets the claim's bytes. */
export interface FunctionMatcher<D> {
	match(text: string, at: number, end: number): number;
	read(claim: string): D | null;
}

/** How a claim draws: a widget, a built-in image or link written in the plugin's own syntax, or its
 *  bytes with a class. */
export type InlineArm<D> =
	| {
			widget: Widget;
			/** Draws into the element the editor made, as a `PluginView` does (`svelteView`, `reactView`). */
			draw(
				target: HTMLElement,
				props: WidgetProps<D>
			): { update?(props: WidgetProps<D>): void; destroy?(): void | Promise<void> };
			/** What the drawing reads of a top-level block, from its content alone (the footnotes it
			 *  references), handed back as `props.depends`; a changed answer draws the widget again. */
			depends?(block: Block): string;
			/** Runs on the click the host picked for links, with `click: 'follow'`. */
			follow?(data: D, editor: Editor): void;
			/** A key pressed while the widget is selected whole: true takes it. Write through
			 *  `props.editor.edit()`; the key's target is the editable it sits in. */
			key?(event: KeyboardEvent, props: WidgetProps<D>): boolean;
	  }
	| ({
			as: 'image';
			image(data: D): ImagePiece;
			/** The claim's bytes holding `image`, or null for an edit the syntax can't hold. Without
			 *  it every edit of the image is refused. */
			write?(image: ImagePiece, data: D): string | null;
	  } & DrawnBuiltIn)
	| ({
			as: 'link';
			/** `text` is a run of the claim's bytes, at `at` or its one run after the prefix: the link
			 *  shows it and hides the rest in live mode. A claim whose text isn't there is the editor's. */
			link(data: D): LinkPiece;
			/** The claim's bytes holding `link`, or null; without it the link card's edits are refused. */
			write?(link: LinkPiece, data: D): string | null;
	  } & DrawnBuiltIn)
	| ({
			class: string;
			/** Runs on the click the host picked for links, as a widget's does; the text stays
			 *  editable. */
			follow?(data: D, editor: Editor): void;
	  } & DrawsNothing);

/** What only a widget's drawing uses, refused on the arms that draw nothing of their own. */
type DrawsNothing = { draw?: never; key?: never; depends?: never };

/** A built-in image or link follows and is styled as one, so the claim's own are refused too. */
type DrawnBuiltIn = DrawsNothing & { follow?: never; class?: never };

export type InlineSpec<D> = InlineCommon<D> & (RegexMatcher<D> | FunctionMatcher<D>) & InlineArm<D>;

/** How a widget edits. `arrows: 'into'` and `click: 'source'` each show its bytes for editing;
 *  `click: 'follow'` runs `follow` on the host's link click, and another click acts as `'source'`
 *  where `arrows` is `'into'`, else as `'none'`. */
export interface Widget {
	/** One key deletes it, or the first selects it and the second deletes. */
	delete: 'whole' | 'select-first';
	/** An arrow steps over it like a character, selects it whole, or shows its bytes. */
	arrows: 'over' | 'select' | 'into';
	click: 'source' | 'follow' | 'none';
	/** `'tall'` stands it in its line as a picture does; a caret beside it draws at the text's height. */
	height?: 'line' | 'tall';
	/** Where the caret may sit in the shown bytes (`$x$` gives `{ start: 1, end: 2 }`). */
	inner?(source: string): { start: number; end: number } | null;
	/** The offset into the bytes a click at `point` names, for a drawing only the plugin can map. */
	caret?(el: HTMLElement, point: { x: number; y: number }): number | null;
}

/** What a widget's drawing gets, updated when its bytes, position, mode or theme change. `from` and
 *  `to` are its document bytes, read when asked. */
export interface WidgetProps<D> {
	readonly data: D;
	readonly source: string;
	readonly from: number;
	readonly to: number;
	readonly mode: Mode;
	readonly theme: string;
	readonly editor: Editor;
	/** What `depends` answered for each top-level block, in `editor.doc.blocks`' order, never changed
	 *  after it's handed over; empty without `depends`. */
	readonly depends: readonly string[];
}

export interface ImagePiece {
	readonly src: string;
	readonly alt: string;
	readonly title: string | null;
	readonly width: number | null;
	readonly height: number | null;
}

export interface LinkPiece {
	readonly href: string;
	readonly text: string;
	readonly title: string | null;
	/** Where `text` starts in the claim. Needed where the claim spells those characters twice
	 *  (`[[notebook|note]]`): without it such a claim is left to the editor. Unset in `write`. */
	readonly at?: number;
}

// ── What an editor installs ──────────────────────────────────────────────────

/** What `inline()` built: everything an editor needs once it names the construct. */
export interface InlineMaking {
	readonly local: string;
	readonly label: string;
	readonly prefix: string;
	readonly after: readonly InlineType[];
	readonly pair: boolean;
	readonly split: 'whole' | 'plain';
	/** The node claimed at `pos` in `[pos, end)`; a widget's or a class's takes `kind`. */
	claim(raw: string, pos: number, end: number, kind: PluginInlineKind): InlineNode | null;
	/** A widget's entry, its plugin named at install; null for the other arms. */
	readonly widget:
		(Omit<WidgetEntry, 'own'> & { own: Omit<NonNullable<WidgetEntry['own']>, 'plugin'> }) | null;
	readonly className: string | null;
	/** A class construct's `follow`. */
	readonly follow?: (data: unknown, editor: Editor) => void;
	/** A mark's run and drawing; null for the other constructs, which claim through `claim`. */
	readonly mark?: MarkMaking | null;
	/** A marker side's text: the side of it a letter typed there joins. */
	readonly marker?: 'after' | 'before';
	/** What a marker side shares with its partner, read off its data. */
	readonly pairKey?: (data: unknown) => string;
}

/** What `mark()` built: its run, the element its text is drawn in, and its toggle. */
export interface MarkMaking {
	readonly marker: string;
	readonly tag: string;
	readonly className: string | null;
	readonly toggle: Command<void>;
}

/** One of an editor's own inline constructs, named and ready to read. */
export interface InstalledInline {
	readonly kind: PluginInlineKind;
	readonly trigger: string;
	/** Null for a mark, which the scan reads as a delimiter run. */
	readonly handler: InlineHandler | null;
	readonly pair: boolean;
	/** The constructs it is tried after on its character, read once every construct is named. */
	readonly after: readonly InlineType[];
	readonly split: 'whole' | 'plain';
	readonly widget: WidgetEntry | null;
	readonly className: string | null;
	/** A class construct's `follow`, and the plugin whose editor it gets. */
	readonly follow: { run(data: unknown, editor: Editor): void; plugin: string } | null;
	readonly mark: Omit<MarkMaking, 'toggle'> | null;
	/** A marker side's text side; null for any other construct. */
	readonly marker: 'after' | 'before' | null;
}

/** An inline construct a maker made; `name` is its local name until an editor names it. */
export function madeInline<D>(making: InlineMaking): Inline<D> {
	const made = { [MAKING]: making, [OWNER]: null as string | null, label: making.label };
	return Object.defineProperty(made, 'name', {
		enumerable: true,
		get: () => (made[OWNER] === null ? making.local : qualifiedName(made[OWNER], making.local))
	}) as unknown as Inline<D>;
}

/** `made`, a class construct, as one side of a marker pair: drawn as a marker, its letters
 *  joining its `text` side. */
export function asMarkerSide<D>(made: Inline<D>, side: Pick<InlineMaking, 'marker' | 'pairKey'>) {
	return madeInline<D>({ ...(made as unknown as Made)[MAKING], className: null, ...side });
}

/** Names the inline constructs one editor's plugins contribute; a construct is the first listing
 *  plugin's, and a clash is reported and left out. */
export function installInlines(
	units: readonly InstalledPlugin[],
	report: (error: PluginError) => void
): { readonly inlines: ReadonlyMap<AnyInlineKind, InstalledInline>; release(): void } {
	const inlines = new Map<AnyInlineKind, InstalledInline>();
	const marks = new Map<string, { mark: MarkMaking; after: InlineType | undefined }>();
	const releases: (() => void)[] = [];
	for (const { name: plugin, contribution } of units) {
		// A marker pair lists as its two sides, each knowing its open side.
		const listing = (contribution.inlines ?? []).flatMap((listed): [Inline, Inline?][] =>
			'open' in listed ? [listed.open, listed.close].map((side) => [side, listed.open]) : [[listed]]
		);
		for (const [listed, opener] of listing) {
			const made = listed as unknown as Partial<Made>;
			const making = made[MAKING];
			const problem = !making
				? `lists '${listed.name}', which \`inline\` didn't make; it's left out`
				: made[OWNER] !== null && made[OWNER] !== plugin
					? `lists the inline '${listed.name}', which plugin '${made[OWNER]}' made; it's left out`
					: inlines.has(qualifiedName(plugin, making.local) as PluginInlineKind)
						? `has two inlines named '${making.local}'; the second is left out`
						: null;
			if (problem || !making) {
				report({ plugin, doing: 'install', cause: new Error(`plugin '${plugin}' ${problem}`) });
				continue;
			}
			made[OWNER] = plugin;
			const kind = listed.name as PluginInlineKind;
			const mark = making.mark ?? null;
			if (mark) {
				// Named here too, so its row names the command whatever reads the list first.
				claimCommand(mark.toggle, plugin);
				marks.set(kind, { mark, after: making.after[0] });
			}
			if (making.marker) {
				// A side listed without its pair keeps its row and pairs with nothing.
				const pair = opener && {
					of: opener.name as PluginInlineKind,
					opens: listed === opener,
					key: making.pairKey
				};
				releases.push(holdInlineConstructPolicy(kind, { ...markerRow(making.marker), pair }));
			}
			inlines.set(kind, {
				kind,
				trigger: making.prefix[0],
				handler: mark
					? null
					: {
							prefix: making.prefix,
							priority: 0,
							recognizer: (raw, pos, end) => making.claim(raw, pos, end, kind),
							owner: plugin
						},
				pair: making.pair,
				after: making.after,
				split: making.split,
				widget: making.widget && { ...making.widget, own: { ...making.widget.own, plugin } },
				className: making.className,
				follow: making.follow ? { run: making.follow, plugin } : null,
				mark: mark && { marker: mark.marker, tag: mark.tag, className: mark.className },
				marker: making.marker ?? null
			});
		}
	}
	// Ranked once every construct is named, so a mark may name one listed after it.
	const ranks = markRanks(marks);
	for (const [kind, { mark }] of marks) {
		const row = markRow(mark, ranks.get(kind)!);
		releases.push(holdInlineConstructPolicy(kind as PluginInlineKind, row));
	}
	return { inlines, release: () => releases.forEach((release) => release()) };
}

/** The toggles of the marks in a contribution's `inlines`, which join its commands. */
export function togglesOf(inlines: Contribution['inlines']): Command<void>[] {
	return (inlines ?? []).flatMap((listed) => (listed as Partial<Made>)[MAKING]?.mark?.toggle ?? []);
}

// ── Internal ─────────────────────────────────────────────────────────────────

// Each mark's rank: just inside the mark its `after` names, else just outside code. A hop is a
// quarter of the one before it, so a chain stays between the built-in marks it started from.
function markRanks(
	marks: ReadonlyMap<string, { after: InlineType | undefined }>
): Map<string, number> {
	const placed = new Map<string, { rank: number; step: number }>();
	const place = (kind: string, path: readonly string[]): { rank: number; step: number } => {
		const done = placed.get(kind);
		if (done) return done;
		const after = marks.get(kind)!.after?.name;
		const own = after !== undefined && marks.has(after) && !path.includes(after);
		const base = own
			? place(after, [...path, kind])
			: { rank: rankOf(after ?? 'strikethrough') ?? rankOf('strikethrough')!, step: 1 };
		const step = base.step / 4;
		const at = { rank: base.rank + step * (1 + nameFraction(kind)), step };
		placed.set(kind, at);
		return at;
	};
	return new Map([...marks.keys()].map((kind) => [kind, place(kind, []).rank]));
}

const rankOf = (kind: string) => getInlineMarkPolicy(kind as AnyInlineKind)?.nestingRank;

// Marks at one place nest in an order their names fix, so the row reads the same in every editor
// whatever its list's order.
function nameFraction(kind: string): number {
	let hash = 0;
	for (let i = 0; i < kind.length; i++) hash = (hash * 31 + kind.charCodeAt(i)) % 999983;
	return hash / 999983;
}

// A mark edits as `**` does: its letters stick left, it unwraps when emptied and Enter closes and
// reopens it.
function markRow(mark: MarkMaking, nestingRank: number): InlineConstructPolicy {
	return {
		edgeAffinity: 'left-sticky',
		autoUnwrapOnEmpty: true,
		splitBehavior: 'close-and-reopen',
		revealable: true,
		prose: 'all',
		mark: { nestingRank, markerBytes: mark.marker, command: mark.toggle.id as AnyCommandId }
	};
}

// A marker side is all marker: a letter typed at it joins its text, a key beside it takes the
// visible character, and emptying the text between two sides leaves both.
function markerRow(text: 'after' | 'before'): InlineConstructPolicy {
	return {
		edgeAffinity: text === 'after' ? 'joins-after' : 'joins-before',
		autoUnwrapOnEmpty: false,
		splitBehavior: 'whole',
		revealable: true,
		prose: 'none'
	};
}

const MAKING = Symbol('Inline.making');
const OWNER = Symbol('Inline.owner');

interface Made {
	readonly [MAKING]: InlineMaking;
	[OWNER]: string | null;
}

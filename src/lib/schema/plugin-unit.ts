/**
 * A plugin as a value. `definePlugin({ name, version, editor, contributes })` makes one; an editor
 * reads its list at mount and calls each plugin's `contributes` with that editor's options, so
 * nothing is registered and what a plugin adds lives and dies with the editor.
 */
import { assertInvariant, devChecksOn } from '@voithos-labs/aragonite/dev-checks';
import { checkDefinedByThisCopy, type CoreCopy } from '../invariants/one-core-copy';
import { ARAGONITE_VERSION } from '../version';
import type { EditorEventMap } from '../editor-events';
import type { PresentationMode } from '../presentation-mode';
import type { Command } from './plugin-command';
import type { InsertRow } from './insert-catalogue';
import type { CaretMenu } from './caret-menu';
import type { SelectionAction } from './selection-action';
import type { Draft } from './drafts';
import type { Block } from './doc-view';
import type { BlockPaint, Paint } from '../decorations/paint';
import type { Inline } from './inline-type';
import { isValidPluginName } from './plugin-name';
import { satisfiesRange } from './version-range';

// ── Public API ───────────────────────────────────────────────────────────────

/** What a plugin author hands to `definePlugin`. */
export interface PluginSpec<O extends object = Record<never, never>> {
	/** Lowercase letters, digits and hyphens; qualifies every block name the plugin defines. */
	name: string;
	version: string;
	/** The editor versions this plugin runs on, as an npm range (`^0.12.0`). */
	editor: string;
	/** Where each editor's options start; options given by calling the plugin are laid over them. */
	defaults?: O;
	/** A sentence when the options are unusable: the editor reports it and runs on the defaults. */
	validate?(options: Readonly<O>): string | undefined;
	/** Plugins this one needs: an editor adds any that aren't listed, with defaults, and leaves this
	 *  one out where one of them is left out. */
	needs?: PluginList;
	/** Names of plugins this one can't run beside; where an editor lists both, the later one is left out. */
	conflicts?: readonly string[];
	/** What the plugin adds to one editor; its local variables are that editor's state. */
	contributes(options: Readonly<O>): Contribution;
}

/** A plugin value: hand it to an editor as it is, or call it with options for one editor. */
export interface Plugin<O extends object = Record<never, never>> {
	/** The same plugin with these options laid over its own. */
	(options: Partial<O>): Plugin<O>;
	readonly name: string;
	readonly version: string;
	readonly editor: string;
	readonly defaults: Readonly<O>;
}

/** The list a host hands an editor, of plugins with any options; the same value twice is one. */
export type PluginList = readonly Pick<Plugin, 'name' | 'version' | 'editor'>[];

/** What a plugin adds to one editor. */
export interface Contribution {
	/** Its block types, made by `lineBlock`, `fencedBlock` or `container`; each is named after the
	 *  plugin (`callouts/callout`) when an editor first runs it. */
	blocks?: readonly BlockType<unknown>[];
	/** Its inline constructs, made by `inline`; each is named after the plugin as a block type is. */
	inlines?: readonly Inline<unknown>[];
	/** Runs once the editor is mounted; what it adds through `editor` goes away with the plugin.
	 *  A function it returns runs once, when the plugin is turned off or the editor unmounts. */
	setup?(editor: Editor): void | (() => void);
	/** Run by value, by `plugin/id`, or by a command's chord anywhere in the editor. */
	commands?: readonly Command<unknown>[];
	/** Rows for the insert menus, listed after the built-ins as `plugin/id`. */
	inserts?: readonly InsertRow[];
	/** True when the plugin checks spelling itself: the browser's own checker is off on the
	 *  editor's prose while the plugin runs, so no word gets two underlines. */
	checksSpelling?: boolean;
	/** Lists that open under the caret when their trigger is typed. */
	menus?: readonly CaretMenu<unknown>[];
	/** Rows over the selection, or a range captured around the caret, in the right-click menu, the
	 *  selection toolbar and `openRows`. */
	actions?: readonly SelectionAction[];
	/** What to lay over `block`, a block of text (one holding no other blocks), asked while it's on
	 *  screen and kept while its bytes hold. */
	paint?(block: Block): readonly Paint[];
	/** Classes and a badge for a block holding other blocks (a list, a quote, a table row), asked
	 *  the same way. Its text is all of its children's, so read its type rather than scan it. */
	paintContainer?(block: Block): readonly BlockPaint[];
}

/** The editor as a plugin's `setup` and a host's handle both see it. */
export interface Editor {
	/** Names of the plugins on in this editor. */
	readonly plugins: readonly string[];
	readonly mode: PresentationMode;
	readonly theme: string;
	/** Every row this editor's insert menus offer, live. */
	readonly inserts: readonly InsertRow[];
	/** Listens until `dispose` is called, the plugin is turned off, or the editor unmounts. */
	on<K extends keyof EditorEventMap>(
		event: K,
		listen: (payload: EditorEventMap[K]) => void
	): () => void;
	/** Runs a command, by value or by id; false, with nothing written, where `can` would say no or
	 *  the command declines. */
	run<A>(command: Command<A>, arg: A): boolean;
	run(command: Command | string, arg?: unknown): boolean;
	can<A>(command: Command<A>, arg: A): boolean;
	can(command: Command | string, arg?: unknown): boolean;
	/** Whether the editor acts on this key, so a host's own shortcut handler can stand back. */
	claims(event: KeyboardEvent): boolean;
	/** Types a caret menu's trigger and `query` at the caret and opens it there, even where a typed
	 *  trigger wouldn't; false, writing nothing, away from prose or for a menu not listed here. */
	openMenu<R>(menu: CaretMenu<R>, query?: string): boolean;
	/** Opens an action's rows over `range` just under `anchor`'s rect (or at its point), following the
	 *  range through a scroll, taking no focus; any edit, Escape or a press elsewhere closes it. */
	openRows(
		action: SelectionAction,
		range: { readonly from: number; readonly to: number },
		anchor: DOMRect | { readonly x: number; readonly y: number },
		/** Told true as the pointer comes onto the menu and false as it leaves, for a hover card. */
		pointer?: (inside: boolean) => void
	): { readonly isOpen: boolean; close(): void };
	/** A write in the document's bytes, committed as one undo step now or after a wait; a plugin's
	 *  is refused as `off` once the plugin is. */
	edit(): Draft;
	/** The deepest block holding document byte `at` (a list item's paragraph, a table cell): a
	 *  marker's byte goes to the text on its line. Null outside the document. */
	blockAt(at: number): Block | null;
	/** The selection in document bytes, `from` first (equal at a caret); null with none, or with
	 *  table cells selected. */
	selectedRange(): { readonly from: number; readonly to: number } | null;
	/** Asks the plugin's `paint` again for `blocks` (one that left the document is skipped), or
	 *  for every block on screen; a host's handle asks every plugin's. */
	repaint(blocks?: readonly Block[]): void;
}

/** A block type as the editor holds it: `name` is its kind, qualified by its plugin's name once an
 *  editor runs the plugin, and `label` what a screen reader and the block menu call it. */
export interface BlockType<D = never> {
	readonly name: string;
	readonly label: string;
	readonly '~data'?: D;
}

/** An error a plugin caused, naming the plugin and what the editor was doing with it. */
export interface PluginError {
	readonly plugin: string;
	readonly doing: string;
	readonly cause: unknown;
}

/** A plugin the install pass kept for one editor, with what it contributed there. */
export interface InstalledPlugin {
	readonly name: string;
	readonly plugin: PluginList[number];
	readonly contribution: Contribution;
}

export function definePluginUnit<O extends object>(spec: PluginSpec<O>): Plugin<O> {
	if (!isValidPluginName(spec.name)) {
		throw new Error(
			`definePlugin: invalid plugin name "${spec.name}"; lowercase first letter, then letters/digits/hyphens`
		);
	}
	return configured(spec, {});
}

/** Whether a `plugins` entry is a plugin value rather than a `setup` plugin. */
export function isPluginValue(entry: unknown): entry is Plugin<object> {
	return typeof entry === 'function' && UNIT in entry;
}

/** Reads one editor's list into the plugins it runs, reporting each one left out and why; a needed
 *  plugin joins ahead of the first one needing it. */
export function installPluginList(
	list: PluginList,
	report: (error: PluginError) => void,
	// What the editor ran before `use`: a plugin value still listed keeps its contribution.
	previous: readonly InstalledPlugin[] = []
): InstalledPlugin[] {
	const listed = new Map<string, PluginList[number]>();
	for (const plugin of list) {
		const held = listed.get(plugin.name);
		if (held === undefined) listed.set(plugin.name, plugin);
		else if (held !== plugin)
			installError(report, plugin.name, 'is listed twice; the first is kept');
	}
	const ordered: PluginList[number][] = [];
	const placed = new Set<string>();
	const place = (plugin: PluginList[number]): void => {
		if (placed.has(plugin.name)) return;
		placed.add(plugin.name);
		for (const need of unitOf(plugin).spec.needs ?? []) place(listed.get(need.name) ?? need);
		ordered.push(plugin);
	};
	for (const plugin of listed.values()) place(plugin);

	const installed: InstalledPlugin[] = [];
	for (const plugin of keepFirstListed(ordered, conflictBetween, report)) {
		const { spec, options } = unitOf(plugin);
		// A need is placed ahead of its plugin, so one left out is already missing here.
		const missing = spec.needs?.find((need) => !installed.some((p) => p.name === need.name));
		if (missing) {
			installError(
				report,
				spec.name,
				`needs '${missing.name}', which is left out, so it's left out too`
			);
			continue;
		}
		assertInvariant('plugin-one-core-copy', () =>
			checkDefinedByThisCopy(spec.name, definingCopy(plugin), THIS_COPY)
		);
		if (devChecksOn && !satisfiesRange(ARAGONITE_VERSION, spec.editor)) {
			installError(report, spec.name, `runs on editor ${spec.editor}, not ${ARAGONITE_VERSION}`);
		}
		const kept = previous.find((p) => p.plugin === plugin);
		const contribution = kept?.contribution ?? contribute(spec, options, report);
		if (contribution) installed.push({ name: spec.name, plugin, contribution });
	}
	return installed;
}

/** Settles every clash between two plugins on one editor by list order: the one listed first stays,
 *  and the later one is left out and reported naming both. `clash` phrases what they share, or null. */
export function keepFirstListed<T extends { readonly name: string }>(
	listed: Iterable<T>,
	clash: (later: T, first: T) => string | null,
	report: (error: PluginError) => void
): T[] {
	const kept: T[] = [];
	for (const later of listed) {
		const lost = kept.map((first) => ({ first, over: clash(later, first) })).find((c) => c.over);
		if (!lost) kept.push(later);
		else {
			const problem = `${lost.over} '${lost.first.name}', listed before it, so it's left out`;
			installError(report, later.name, problem);
		}
	}
	return kept;
}

/** One editor's options: the defaults, then each field the host set that isn't `undefined`. */
export function mergeOptions<O extends object>(defaults: O | undefined, raw: unknown): O {
	return { ...defaults, ...definedFields(raw) } as O;
}

// ── One copy of the editor ───────────────────────────────────────────────────

// Every copy of the core marks the plugins it defines under one shared key, each with its own value.
const DEFINED_BY = Symbol.for('@voithos-labs/aragonite:defined-by');
export const THIS_COPY: CoreCopy = Object.freeze({ version: ARAGONITE_VERSION });

/** Marked in every build, not just with checks on: the copy that defined it may run without them. */
export function markDefinedHere(plugin: object): void {
	if (Object.isExtensible(plugin)) Object.defineProperty(plugin, DEFINED_BY, { value: THIS_COPY });
}

export const definingCopy = (plugin: object): CoreCopy | undefined =>
	(plugin as { [DEFINED_BY]?: CoreCopy })[DEFINED_BY];

// ── Internal ─────────────────────────────────────────────────────────────────

// Shared across copies of the core, so a plugin another copy defined still reads.
const UNIT = Symbol.for('@voithos-labs/aragonite:plugin-unit');

interface Unit {
	spec: PluginSpec<object>;
	options: object;
}

const unitOf = (plugin: object): Unit => (plugin as { [UNIT]: Unit })[UNIT];

function configured<O extends object>(spec: PluginSpec<O>, options: Partial<O>): Plugin<O> {
	const plugin = ((more: Partial<O>) => configured(spec, { ...options, ...more })) as Plugin<O>;
	Object.defineProperties(plugin, {
		name: { value: spec.name },
		version: { value: spec.version },
		editor: { value: spec.editor },
		defaults: { value: Object.freeze({ ...spec.defaults }) },
		[UNIT]: { value: { spec, options } satisfies Unit }
	});
	markDefinedHere(plugin);
	return plugin;
}

function conflictBetween(later: PluginList[number], first: PluginList[number]): string | null {
	const declares = (a: PluginList[number], b: PluginList[number]) =>
		unitOf(a).spec.conflicts?.includes(b.name);
	return declares(later, first) || declares(first, later) ? "can't run beside" : null;
}

function contribute(
	spec: PluginSpec<object>,
	raw: object,
	report: (error: PluginError) => void
): Contribution | null {
	const options = validOptions(spec, mergeOptions(spec.defaults, raw), report);
	try {
		return spec.contributes(options);
	} catch (cause) {
		report({ plugin: spec.name, doing: 'contributes', cause });
		return null;
	}
}

// A `validate` that throws is read as one that returned a sentence: reported, and the defaults run.
function validOptions(
	spec: PluginSpec<object>,
	options: object,
	report: (error: PluginError) => void
): object {
	let problem: unknown;
	try {
		const sentence = spec.validate?.(options);
		if (sentence === undefined) return options;
		problem = new Error(sentence);
	} catch (cause) {
		problem = cause;
	}
	report({ plugin: spec.name, doing: 'validate', cause: problem });
	return mergeOptions(spec.defaults, undefined);
}

function installError(report: (error: PluginError) => void, name: string, problem: string): void {
	report({ plugin: name, doing: 'install', cause: new Error(`plugin '${name}' ${problem}`) });
}

// A field set to `undefined` keeps its default, the same as leaving it out.
function definedFields(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
	return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

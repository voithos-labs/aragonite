/**
 * A plugin block type as an editor installs it. A maker builds everything the type needs when it's
 * called; an editor running the plugin names the type after it (`callouts/callout`), reads its
 * opener and view itself, and lends its facts to the page for as long as it runs it.
 */
import type { AnyBlockKind, PluginBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { LineEnding } from '../core/lines';
import type { BlockOpener, GrammarView } from './block-openers';
import type { BlockCompleter } from './block-completions';
import type { BlockView } from './block-view';
import type { BlockAction, BlockCommon, BlockInsert, BlockKey } from './block-shapes';
import { holdBlockKind, rejectBlankLabel, type BuiltinRegistration } from './block-kind-descriptor';
import { normalizeChord, type KeyBinding } from './keybindings';
import type { Command } from './plugin-command';
import { qualifiedName } from './plugin-name';
import type { BlockType, InstalledPlugin, PluginError } from './plugin-unit';

/** What a maker built for a block type; `D` is the data its menu rows read. */
export interface BlockMaking<D = unknown> {
	readonly local: string;
	readonly label: string;
	readonly icon?: BlockCommon<unknown>['icon'];
	/** Lower is tried first, as `OPENER_PRIORITIES` orders the built-ins. */
	readonly priority: number;
	readonly registration: BuiltinRegistration;
	readonly view: BlockView;
	/** The parser's ways into the type, for the kind its editor named it; none for one no line opens. */
	openers(kind: PluginBlockKind): readonly BlockOpener[];
	readonly completer: BlockCompleter | null;
	readonly insert: BlockInsert;
	/** Where a leaf's text sits in its bytes, read for `Block.body` however the leaf edits. */
	readonly bodyRange?: ((node: NodeView) => { start: number; end: number } | null) | null;
	/** For a fenced type that may sit on one line: whether `line` is a whole block of it. */
	readonly oneLine?: (line: string) => boolean;
	/** The block's bytes with `data` written into them; null where the type has no writer for it. */
	readonly writeData?: (node: NodeView, data: unknown, grammar: GrammarView) => string | null;
	/** The changes that write `text` as the block's body where `at` places it; null where that
	 *  wouldn't read back as the type. A maker brings it, so the core imports no body writer. */
	readonly writeBody?: (node: NodeView, text: string, at: BodyPlace) => BodyChange[] | null;
	readonly chords?: BlockCommon<unknown, BlockKey, never>['chords'];
	readonly actions?: readonly BlockAction<D, never>[];
	readonly commands?: readonly Command<unknown, never>[];
}

/** Where a body write lands: the document's bytes, the byte of an offset into the block's own
 *  bytes, and the line ending the document falls back to. */
export interface BodyPlace {
	source: string;
	byteAt(offset: number): number;
	eol: LineEnding;
}

/** One change a body write makes, in document bytes. */
export interface BodyChange {
	from: number;
	to: number;
	insert: string;
}

/** One of an editor's own block types, named and ready to read. */
export interface InstalledBlock {
	readonly kind: AnyBlockKind;
	readonly openers: readonly BlockOpener[];
	readonly view: BlockView;
	readonly completer: BlockCompleter | null;
}

/** A block type a maker made; `name` is its local name until an editor names it after its plugin. */
export function madeBlockType<D>(making: BlockMaking<D>): BlockType<D> {
	// Where every maker passes, so no type can show the drag ghost an empty name.
	rejectBlankLabel(
		'block type',
		making.local as AnyBlockKind,
		'dragLabel',
		making.registration.dragLabel
	);
	const type = { [MAKING]: making, [OWNER]: null as string | null, label: making.label };
	return Object.defineProperty(type, 'name', {
		enumerable: true,
		get: () => (type[OWNER] === null ? making.local : qualifiedName(type[OWNER], making.local))
	}) as unknown as BlockType<D>;
}

/** What a maker built for `type`; undefined for a built-in. */
export function makingOf(type: BlockType<unknown>): BlockMaking | undefined {
	return (type as Partial<Made>)[MAKING];
}

/** Names and holds the block types one editor's plugins contribute, each release pushed on `held`
 *  (`own-syntax.ts` gives them back); a clash is reported and left out. */
export function installBlockTypes(
	units: readonly InstalledPlugin[],
	report: (error: PluginError) => void,
	held: (() => void)[]
): readonly InstalledBlock[] {
	const blocks: InstalledBlock[] = [];
	for (const { name: plugin, contribution } of units) {
		for (const type of contribution.blocks ?? []) {
			const made = type as unknown as Made;
			const problem =
				made[OWNER] !== null && made[OWNER] !== plugin
					? `lists the block type '${type.name}', which plugin '${made[OWNER]}' made`
					: blocks.some((b) => b.kind === qualifiedName(plugin, made[MAKING].local))
						? `has two block types named '${made[MAKING].local}'`
						: null;
			if (problem) {
				const cause = new Error(`plugin '${plugin}' ${problem}; the second is left out`);
				report({ plugin, doing: 'install', cause });
				continue;
			}
			made[OWNER] = plugin;
			const making = made[MAKING];
			const kind = type.name as PluginBlockKind;
			const openers = making.openers(kind);
			const registration = withChords(making.registration, making.chords);
			held.push(holdBlockKind(kind, registration, openers.length > 0, plugin));
			blocks.push({ kind, openers, view: making.view, completer: making.completer });
		}
	}
	return blocks;
}

/** The type's keymap with its own keys first, each bound to its command's id; the install pass
 *  claimed those commands for the plugin before this runs, so the ids are qualified. */
function withChords(
	registration: BuiltinRegistration,
	chords: BlockMaking['chords']
): BuiltinRegistration {
	const own: KeyBinding[] = Object.entries(chords ?? {}).flatMap(([key, value]) => {
		const command = (value as Command<unknown, never> | undefined)?.id as KeyBinding['command'];
		return command ? [{ chord: normalizeChord(key), command }] : [];
	});
	if (own.length === 0) return registration;
	return { ...registration, keymap: [...own, ...(registration.keymap ?? [])] };
}

// ── Internal ─────────────────────────────────────────────────────────────────

const MAKING = Symbol('BlockType.making');
const OWNER = Symbol('BlockType.owner');

interface Made {
	readonly [MAKING]: BlockMaking;
	[OWNER]: string | null;
}

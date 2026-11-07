/**
 * A plugin block type as an editor installs it. A maker builds everything the type needs when it's
 * called; an editor running the plugin names the type after it (`callouts/callout`), reads its
 * opener and view itself, and lends its facts to the page for as long as it runs it.
 */
import type { AnyBlockKind, PluginBlockKind } from '../core/nodes';
import type { BlockOpener } from './block-openers';
import type { BlockView } from './block-view';
import { holdBlockKind, type BuiltinRegistration } from './block-kind-descriptor';
import { qualifiedName } from './plugin-name';
import type { BlockType, InstalledPlugin, PluginError } from './plugin-unit';

/** What a maker built for a block type. */
export interface BlockMaking {
	readonly local: string;
	readonly label: string;
	/** Lower is tried first, as `OPENER_PRIORITIES` orders the built-ins. */
	readonly priority: number;
	readonly registration: BuiltinRegistration;
	readonly view: BlockView;
	/** The parser's way into the type, for the kind its editor named it; null for one no line opens. */
	opener(kind: PluginBlockKind): BlockOpener | null;
}

/** One of an editor's own block types, named and ready to read. */
export interface InstalledBlock {
	readonly kind: AnyBlockKind;
	readonly opener: BlockOpener | null;
	readonly view: BlockView;
}

/** A block type a maker made; `name` is its local name until an editor names it after its plugin. */
export function madeBlockType<D>(making: BlockMaking): BlockType<D> {
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

/** Names and holds the block types one editor's plugins contribute; a type is the first listing
 *  plugin's, and a clash is reported and left out. `release` gives the facts back. */
export function installBlockTypes(
	units: readonly InstalledPlugin[],
	report: (error: PluginError) => void
): { readonly blocks: readonly InstalledBlock[]; release(): void } {
	const blocks: InstalledBlock[] = [];
	const releases: (() => void)[] = [];
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
			const opener = making.opener(kind);
			releases.push(holdBlockKind(kind, making.registration, opener !== null));
			blocks.push({ kind, opener, view: making.view });
		}
	}
	return { blocks, release: () => releases.forEach((release) => release()) };
}

// ── Internal ─────────────────────────────────────────────────────────────────

const MAKING = Symbol('BlockType.making');
const OWNER = Symbol('BlockType.owner');

interface Made {
	readonly [MAKING]: BlockMaking;
	[OWNER]: string | null;
}

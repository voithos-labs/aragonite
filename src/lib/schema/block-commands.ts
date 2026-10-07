/**
 * The `(kind, id) → handler` registry of block commands and every dispatch path over it. A chord
 * on a leaf or a container, `EditorInstance.runCommand`, and the "can this run" read all resolve
 * through the same lookup, so a rule that holds however a command was invoked is enforced once.
 * Register-once, throw on duplicate. Not in `./commands`: `commands → block-commands → command-id`
 * would be an import cycle.
 */
import type { AnyBlockKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import { mintCommandId, type AnyCommandId, type PluginCommandId } from './command-id';
import type { PluginActivation } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';
import {
	resolveBinding,
	resolveKindBinding,
	getCommand,
	isCommandRegistered,
	warnDeadKeyCommand,
	isBuiltinCommandId,
	runPluginCommand,
	AFTER_RANGE_REMOVAL_COMMAND_IDS,
	AFTER_SELECTION_REMOVAL_COMMAND_IDS,
	CROSS_BLOCK_RANGE_COMMAND_IDS,
	RANGE_DECLINED_COMMAND_IDS,
	type CommandDispatchPath,
	type GlobalCommandContext,
	type GlobalCommandRun
} from './commands';
import type { KeybindingOverrideMap } from './keybinding-overrides';
import { pluginEditorFor, type EditorContext } from './plugin-install';
import { isReadingMode, type PresentationMode } from '../presentation-mode';

export interface BlockCommandContext {
	/** A read-only view of the node; metadata edits go through `updateMetadata`. */
	node: NodeView;
	arg: unknown;
	updateMetadata(patch: Record<string, unknown>): void;
	/**
	 * The mounted component's view-state hooks, cast by the plugin to its own type. `undefined`
	 * when no component is mounted, and a handler must then decline cleanly.
	 */
	hooks?: unknown;
	/** The dispatching editor's `EditorContext` for the plugin that registered the command.
	 *  Undefined when the dispatch is not wired to an editor instance. */
	editor?: EditorContext;
	/** True when the dispatch removed a selection before running the command, so a line the removal
	 *  emptied isn't one the user left empty (`CommandRun`). */
	afterRemoval: boolean;
}

/** How a command came to run. `afterRemoval`: the dispatch removed a selection first, in the
 *  block or across blocks, so an "Enter on an empty line" exit must not read the emptiness the
 *  removal left; a break over a selection splits and never leaves the block. */
export interface CommandRun {
	afterRemoval: boolean;
}

const AT_CARET: CommandRun = { afterRemoval: false };

export type BlockCommandHandler = (ctx: BlockCommandContext) => boolean;

/** How a block command behaves over a selection. `'afterRemoval'` removes the selection, the way
 *  Backspace would, then runs the command at the caret that's left: `overRange` over a selection
 *  spanning blocks, by a key bound to it; `overSelection` over one inside the command's own
 *  block, however the command runs. A command that puts a line break at the caret wants both. */
export interface BlockCommandOptions {
	overRange?: 'afterRemoval';
	overSelection?: 'afterRemoval';
}

/** What the focused block supplies; the dispatch adds the argument and the editor context. */
export type BlockCommandTarget = Omit<BlockCommandContext, 'arg' | 'editor' | 'afterRemoval'>;

interface RegisteredBlockCommand {
	handler: BlockCommandHandler;
	options: BlockCommandOptions;
}

const blockCommands = createPluginRegistry<string, RegisteredBlockCommand>({
	label: 'registerBlockCommand',
	isBuiltin: () => false
});

const compositeKey = (kind: AnyBlockKind, id: string): string => `${kind} ${id}`;

// The two ids every block answers the same way, so they resolve here rather than per component.
const MOVE_STEP: Partial<Record<string, -1 | 1>> = { 'block.moveUp': -1, 'block.moveDown': 1 };

/**
 * A duplicate `(kind, name)` reports as a register-once conflict, not an id collision, and the
 * name is validated before the handler is stored, so an invalid name leaves no orphaned handler.
 */
export function registerBlockCommand(
	kind: AnyBlockKind,
	name: string,
	handler: BlockCommandHandler,
	options: BlockCommandOptions = {}
): PluginCommandId {
	const key = compositeKey(kind, name);
	// A taken key throws here, or on a dev server replaces the handler under the id it already has.
	const id = blockCommands.has(key) ? (name as PluginCommandId) : mintCommandId(name);
	blockCommands.register(
		key,
		{ handler, options },
		`registerBlockCommand: (${kind}, ${name}) is already registered — block commands are register-once`
	);
	return id;
}

/** The handler where `activation` resolves the plugin that registered it. */
export function getBlockCommand(
	kind: AnyBlockKind,
	id: AnyCommandId,
	activation: PluginActivation
): BlockCommandHandler | undefined {
	return blockCommands.get(compositeKey(kind, id), activation)?.handler;
}

/** What a command at `kind` does over a selection spanning blocks: a built-in in
 *  `AFTER_RANGE_REMOVAL_COMMAND_IDS`, or a plugin command registered with `overRange`. */
export function commandOverRange(
	kind: AnyBlockKind,
	id: AnyCommandId,
	activation: PluginActivation
): BlockCommandOptions['overRange'] {
	if (AFTER_RANGE_REMOVAL_COMMAND_IDS.has(id)) return 'afterRemoval';
	return blockCommands.get(compositeKey(kind, id), activation)?.options.overRange;
}

/** What a command at `kind` does over a selection inside its block: a built-in in
 *  `AFTER_SELECTION_REMOVAL_COMMAND_IDS`, or a plugin command registered with `overSelection`. */
export function commandOverSelection(
	kind: AnyBlockKind,
	id: AnyCommandId,
	activation: PluginActivation
): BlockCommandOptions['overSelection'] {
	if (AFTER_SELECTION_REMOVAL_COMMAND_IDS.has(id)) return 'afterRemoval';
	return blockCommands.get(compositeKey(kind, id), activation)?.options.overSelection;
}

// ── Dispatch ─────────────────────────────────────────────────────────────

/**
 * The cross-block handler a range command routes to, injected because this schema module may not
 * import the selection code. `canRun` asks whether the handler is reachable, not whether it will
 * act: a keypress whose range reaches no block still consumes the chord and writes nothing.
 */
export interface CrossBlockCommandRouter {
	canRun(id: AnyCommandId): boolean;
	run(id: AnyCommandId): boolean;
	isActive(id: AnyCommandId): boolean;
}

/**
 * The editor state that decides whether a command may run, whatever invoked it. Getters, never
 * values: they change between one dispatch and the next.
 */
export interface CommandGates {
	getPresentationMode: () => PresentationMode;
	/** The plugins the editor activated: a plugin's command resolves only where it is listed. */
	activation: PluginActivation;
	/** True while a cross-block range is painted. */
	isCrossBlockRange(): boolean;
	crossBlockCommands: CrossBlockCommandRouter;
}

/** Moves the block at a path one step among its siblings: the editor's reorder action. Resolves to
 *  whether the move landed. */
export interface BlockMover {
	nudgeReorderUnit(path: number[], dir: -1 | 1): Promise<boolean>;
}

/** Everything a chord or `EditorInstance.runCommand` dispatches against, built once per editor so
 *  every dispatch site shares one history, one set of overrides and one error channel. */
export interface CommandDispatchContext extends CommandGates {
	history: GlobalCommandContext['history'];
	pluginEditor: GlobalCommandContext['pluginEditor'];
	keybindingOverrides(): KeybindingOverrideMap | undefined;
	onCommandError: CommandErrorSink;
	/** Runs `block.moveUp` and `block.moveDown` for every block, against the target's path. */
	reorder: BlockMover;
}

export interface KindCommandTarget {
	kind: AnyBlockKind;
	/** The block's own built-in commands. Absent on a block that owns none (a plugin container),
	 *  where a built-in id declines. */
	runCommand?(id: AnyCommandId, arg?: unknown, run?: CommandRun): boolean;
	// What a plugin block command runs against, supplied by the focused block; without it no
	// plugin command resolves, and both dispatch and the "can this run" read fall to `runCommand`.
	getCommandContext?(): BlockCommandTarget;
	/** Whether the id is toggled on at this block's caret or selection, which a toolbar shows as
	 *  pressed. Absent means the block has no toggle state to report, which reads as inactive. */
	isCommandActive?(id: AnyCommandId): boolean;
	/** The focused block's path, which `block.moveUp` and `block.moveDown` move. A container a key
	 *  bubbles up to supplies none: the block below it already ran the move. */
	getPath?(): number[];
	/** Runs `run` once a source the block shows is hidden and written, so a move takes the written
	 *  bytes along. Absent runs it at once. */
	afterSourceCommit?(run: () => void): void;
	/** Removes the block's own selection, then runs `run` at the caret that's left, one undo entry
	 *  with the removal; with nothing selected it returns `run`'s answer. Absent runs it at once. */
	afterSelectionRemoved?(run: (removed: boolean) => boolean): boolean;
}

/**
 * A caught plugin command failure, naming the plugin that registered the command; a block command
 * also reports its `kind`. Dispatch hands it to the caller's callback, which routes it to the
 * editor's error event (`origin: 'command'`, `editor-events.ts`), injected so this schema module
 * imports nothing from the editor shell.
 */
export interface CommandErrorReport {
	kind?: AnyBlockKind;
	command: AnyCommandId;
	plugin?: string;
	error: unknown;
}
export type CommandErrorSink = (report: CommandErrorReport) => void;

/** Which level answers an id: `'dead'` is bound but unanswered (and warns), `'no-surface'` has no
 *  block or `runCommand` to reach, `'unlisted'` is a plugin command this editor left inactive. */
type BlockLocalResolution =
	| {
			tier: 'minted';
			target: KindCommandTarget;
			handler: BlockCommandHandler;
			context: BlockCommandTarget;
			/** The plugin whose setup registered the handler, whose editor context it runs with. */
			owner: string | null;
	  }
	| { tier: 'builtin'; target: KindCommandTarget }
	| { tier: 'move'; target: KindCommandTarget; path: () => number[]; dir: -1 | 1 }
	| { tier: 'dead' }
	| { tier: 'no-surface' }
	| { tier: 'unlisted' };

type CommandResolution = { tier: 'global'; run: GlobalCommandRun } | BlockLocalResolution;

/**
 * The block-level lookups, in dispatch order. A global id resolves as dead here, since the leaf
 * already ran it and a container must never re-fire the focused leaf's undo.
 */
function resolveBlockLocalCommand(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	activation: PluginActivation
): BlockLocalResolution {
	if (!target) return { tier: 'no-surface' };
	if (getCommand(id, activation)) return { tier: 'dead' };
	const handler = getBlockCommand(target.kind, id, activation);
	// A context is built only where a handler matched, so a built-in id costs nothing extra on the
	// read a host may run per selection change.
	const context = handler ? target.getCommandContext?.() : undefined;
	if (handler && context) {
		const owner = blockCommands.ownerOf(compositeKey(target.kind, id));
		return { tier: 'minted', target, handler, context, owner };
	}
	const dir = MOVE_STEP[id];
	if (dir && target.getPath) return { tier: 'move', target, path: target.getPath, dir };
	if (isBuiltinCommandId(id)) {
		return target.runCommand ? { tier: 'builtin', target } : { tier: 'no-surface' };
	}
	const installedElsewhere =
		isCommandRegistered(id) || blockCommands.has(compositeKey(target.kind, id));
	return installedElsewhere && !handler ? { tier: 'unlisted' } : { tier: 'dead' };
}

/** The full lookup: global commands first, then the block-level ones. Both the dispatch and the
 *  "can this run" read use it, so a greyed-out button cannot disagree with the click under it. */
function resolveCommand(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	activation: PluginActivation
): CommandResolution {
	const globalRun = getCommand(id, activation);
	if (globalRun) return { tier: 'global', run: globalRun };
	return resolveBlockLocalCommand(id, target, activation);
}

/** Run a resolved block-level command, after removing the block's own selection where the command
 *  asks for that, however it was invoked. */
function runBlockLocalCommand(
	resolved: BlockLocalResolution,
	id: AnyCommandId,
	arg: unknown,
	path: CommandDispatchPath,
	ctx: CommandDispatchContext,
	run: CommandRun
): boolean {
	const target = 'target' in resolved ? resolved.target : null;
	if (!target?.afterSelectionRemoved || !commandOverSelection(target.kind, id, ctx.activation)) {
		return runAtCaret(resolved, id, arg, path, ctx, run);
	}
	// Resolved again after the removal, so a plugin's handler reads the block it left.
	return target.afterSelectionRemoved((removed) =>
		runAtCaret(resolveBlockLocalCommand(id, target, ctx.activation), id, arg, path, ctx, {
			afterRemoval: removed || run.afterRemoval
		})
	);
}

/** Run a resolved block-level command, catching and reporting a plugin throw; an id no handler
 *  answers declines with a warning. */
function runAtCaret(
	resolved: BlockLocalResolution,
	id: AnyCommandId,
	arg: unknown,
	path: CommandDispatchPath,
	ctx: CommandDispatchContext,
	run: CommandRun
): boolean {
	switch (resolved.tier) {
		case 'minted': {
			const { owner, handler, context, target } = resolved;
			const editor = pluginEditorFor(ctx.pluginEditor, owner);
			return runPluginCommand(owner, { kind: target.kind, command: id }, ctx.onCommandError, () =>
				handler({ ...context, editor, arg, afterRemoval: run.afterRemoval })
			);
		}
		case 'builtin':
			return resolved.target.runCommand?.(id, arg, run) ?? false;
		case 'move': {
			const { target, path, dir } = resolved;
			const move = () => void ctx.reorder.nudgeReorderUnit(path(), dir);
			if (target.afterSourceCommit) target.afterSourceCommit(move);
			else move();
			return true;
		}
		case 'dead':
			warnDeadKeyCommand(id, path);
			return false;
		case 'no-surface':
		case 'unlisted':
			return false;
	}
}

/** `ranged` travels with the block-level answer because a selection no handler reads is not the
 *  same state as a caret, and only this lookup has already asked the question. */
type RangeRoute =
	| { kind: 'block-local'; ranged: boolean }
	| { kind: 'decline' }
	| { kind: 'cross-block'; router: CrossBlockCommandRouter };

/**
 * While a selection spans blocks, a single-block command routes to the cross-block handler or
 * declines (`RANGE_DECLINED_COMMAND_IDS`); anything else runs on the focused block.
 */
function rangeRouteFor(id: AnyCommandId, gates: CommandGates): RangeRoute {
	// Called directly, not optionally: a caller without the getter throws rather than skipping.
	if (!gates.isCrossBlockRange()) return { kind: 'block-local', ranged: false };
	if (RANGE_DECLINED_COMMAND_IDS.has(id)) return { kind: 'decline' };
	if (!CROSS_BLOCK_RANGE_COMMAND_IDS.has(id)) return { kind: 'block-local', ranged: true };
	const router = gates.crossBlockCommands;
	return router.canRun(id) ? { kind: 'cross-block', router } : { kind: 'decline' };
}

/** The one dispatch keyed by id, which a chord and `EditorInstance.runCommand` both reach. With no
 *  focused block (a null target) only global commands run; reading mode runs none. */
function runResolvedCommand(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext,
	path: CommandDispatchPath,
	run: CommandRun
): boolean {
	if (isReadingMode(ctx.getPresentationMode)) return false;
	const route = rangeRouteFor(id, ctx);
	if (route.kind === 'decline') return false;
	if (route.kind === 'cross-block') return route.router.run(id);
	const resolved = resolveCommand(id, target, ctx.activation);
	if (resolved.tier === 'global') return resolved.run({ ...ctx, arg });
	return runBlockLocalCommand(resolved, id, arg, path, ctx, run);
}

/**
 * The read behind `EditorInstance.canRunCommand`, through the dispatch's own checks and lookup.
 * Silent, since a host may ask on every selection change and must not spend the dead-key warnings.
 */
export function canRunCommandById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	if (isReadingMode(gates.getPresentationMode)) return false;
	const route = rangeRouteFor(id, gates);
	if (route.kind !== 'block-local') return route.kind === 'cross-block';
	const { tier } = resolveCommand(id, target, gates.activation);
	return tier === 'global' || tier === 'minted' || tier === 'builtin' || tier === 'move';
}

/** The read behind `EditorInstance.isCommandActive`: state, not permission, so a disabled button
 *  may still show pressed. Whoever would run the command answers. */
export function isCommandActiveById(
	id: AnyCommandId,
	target: KindCommandTarget | null,
	gates: CommandGates
): boolean {
	const route = rangeRouteFor(id, gates);
	if (route.kind === 'cross-block') return route.router.isActive(id);
	// A selection no handler reads has no pressed state: the focused block only holds a resting
	// caret, whose bytes are not the ones the command would rewrite.
	if (route.kind === 'decline' || route.ranged) return false;
	return target?.isCommandActive?.(id) ?? false;
}

/** The `EditorInstance.runCommand` entry point: an id with no keystroke behind it. */
export function runCommandById(
	id: AnyCommandId,
	arg: unknown,
	target: KindCommandTarget | null,
	ctx: CommandDispatchContext
): boolean {
	return runResolvedCommand(id, arg, target, ctx, 'door', AT_CARET);
}

/** Chord dispatch on the focused leaf: an editable block, or a container's title row. A key that
 *  runs after a range's removal says so in `run`. */
export function dispatchKeyCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: CommandDispatchContext,
	run: CommandRun = AT_CARET
): boolean {
	const binding = resolveBinding(chord, target.kind, ctx.keybindingOverrides(), ctx.activation);
	if (!binding || leftUnderLiveRange(binding.command, target, ctx)) return false;
	return runResolvedCommand(binding.command, binding.arg, target, ctx, 'chord', run);
}

/** A command meant to run once a range is removed, reached by a key the range didn't claim (the
 *  block it would land in binds the key otherwise): run here, it would write under the live range. */
function leftUnderLiveRange(
	id: AnyCommandId,
	target: KindCommandTarget,
	ctx: CommandDispatchContext
): boolean {
	return ctx.isCrossBlockRange() && commandOverRange(target.kind, id, ctx.activation) !== undefined;
}

/** Dispatch for a chord at a container: kind commands only, since undo/redo and the range
 *  commands belong to the focused leaf and would otherwise fire twice. */
export function dispatchKindCommand(
	chord: string,
	target: KindCommandTarget,
	ctx: CommandDispatchContext
): boolean {
	const binding = resolveKindBinding(chord, target.kind, ctx.keybindingOverrides());
	if (!binding || isReadingMode(ctx.getPresentationMode)) return false;
	if (rangeRouteFor(binding.command, ctx).kind !== 'block-local') return false;
	if (leftUnderLiveRange(binding.command, target, ctx)) return false;
	const resolved = resolveBlockLocalCommand(binding.command, target, ctx.activation);
	return runBlockLocalCommand(resolved, binding.command, binding.arg, 'chord', ctx, AT_CARET);
}

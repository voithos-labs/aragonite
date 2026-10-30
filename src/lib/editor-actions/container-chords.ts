/**
 * The chords the containers holding a key take, run from the keydown of the block the key is in as
 * its last step rather than from each container's element, so no container's handler, or lack of
 * one, or a plugin's `stopPropagation` decides whether a container chord runs. One attempt per key.
 */

import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import { recordContainerChordWalk } from '../perf/instruments';
import {
	dispatchKindCommand,
	kindChordRuns,
	type CommandDispatchContext,
	type KindCommandTarget
} from '../schema/block-commands';
import { containerMayBind } from '../schema/commands';
import { eventToChord } from '../schema/keybindings';
import { rangeOwnsKey } from '../selection/cross-block/keydown';
import type { SelectionState } from '../selection/selection-state.svelte';

export interface ContainerChordDeps {
	commands: CommandDispatchContext;
	getBlockComponent(path: number[]): BlockComponent | null;
	selection: Pick<SelectionState, 'isCrossBlock' | 'anchor' | 'focus'>;
	getDoc(): Document;
}

export interface ContainerChords {
	/** Runs the chord the nearest container holding the block at `from`, or that block itself,
	 *  binds; true when one ran. */
	take(e: KeyboardEvent, from: readonly number[]): boolean;
	/** Whether `take` would run one, without running it: what `claimsChord` reads. */
	takes(e: KeyboardEvent, from: readonly number[]): boolean;
	/** Whether `take` could run one from anywhere, asked before finding where the key landed. */
	mayTake(e: KeyboardEvent): boolean;
}

export function createContainerChords(deps: ContainerChordDeps): ContainerChords {
	const attempted = new WeakSet<KeyboardEvent>();

	/** The containers holding a key in the block at `from`, that block first, as the targets their
	 *  chords run against. A leaf publishes no target, so for a leaf the walk starts above it. */
	function* targetsAround(chord: string, from: readonly number[]): Generator<KindCommandTarget> {
		recordContainerChordWalk();
		for (let depth = from.length; depth >= 1; depth--) {
			const target = deps.getBlockComponent(from.slice(0, depth))?.containerChordTarget?.(from);
			if (target) yield target;
		}
	}

	/** The chord a container could bind, or null; a live range keeps the keys its own handler
	 *  claims, which no container may run too. */
	function containerChordOf(e: KeyboardEvent): string | null {
		const chord = eventToChord(e);
		if (!chord || !containerMayBind(chord, deps.commands.keybindingOverrides())) return null;
		const rangeOwns = deps.selection.isCrossBlock && rangeOwnsKey(e, deps);
		return rangeOwns ? null : chord;
	}

	return {
		take(e, from) {
			if (e.defaultPrevented || attempted.has(e)) return false;
			attempted.add(e);
			const chord = containerChordOf(e);
			if (!chord) return false;
			for (const target of targetsAround(chord, from)) {
				if (dispatchKindCommand(chord, target, deps.commands)) {
					e.preventDefault();
					return true;
				}
			}
			return false;
		},
		takes(e, from) {
			const chord = containerChordOf(e);
			if (!chord) return false;
			for (const target of targetsAround(chord, from)) {
				if (kindChordRuns(chord, target, deps.commands)) return true;
			}
			return false;
		},
		mayTake: (e) => !e.defaultPrevented && !attempted.has(e) && containerChordOf(e) !== null
	};
}

/**
 * The chords the containers around a block take, run from the block's own keydown as its last
 * step rather than from each container's element, so no container's handler, or lack of one, or
 * a plugin's `stopPropagation` decides whether a container chord runs. One attempt per keystroke.
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
	/** Runs the chord the nearest container around `from` binds; true when one ran. */
	take(e: KeyboardEvent, from: readonly number[]): boolean;
	/** Whether `take` would run one, without running it: what `claimsChord` reads. */
	takes(e: KeyboardEvent, from: readonly number[]): boolean;
}

export function createContainerChords(deps: ContainerChordDeps): ContainerChords {
	const attempted = new WeakSet<KeyboardEvent>();

	/** The containers around `from`, nearest first, as the targets their chords run against. */
	function* targetsAround(chord: string, from: readonly number[]): Generator<KindCommandTarget> {
		if (!containerMayBind(chord, deps.commands.keybindingOverrides())) return;
		recordContainerChordWalk();
		for (let depth = from.length - 1; depth >= 1; depth--) {
			const target = deps.getBlockComponent(from.slice(0, depth))?.containerChordTarget?.(from);
			if (target) yield target;
		}
	}

	// A live range takes the keys its own handler claims, which no container may run too.
	const rangeOwns = (e: KeyboardEvent) =>
		deps.selection.isCrossBlock && rangeOwnsKey(e, { ...deps, commands: deps.commands });

	return {
		take(e, from) {
			if (e.defaultPrevented || attempted.has(e)) return false;
			attempted.add(e);
			const chord = eventToChord(e);
			if (!chord || rangeOwns(e)) return false;
			for (const target of targetsAround(chord, from)) {
				if (dispatchKindCommand(chord, target, deps.commands)) {
					e.preventDefault();
					return true;
				}
			}
			return false;
		},
		takes(e, from) {
			const chord = eventToChord(e);
			if (!chord || rangeOwns(e)) return false;
			for (const target of targetsAround(chord, from)) {
				if (kindChordRuns(chord, target, deps.commands)) return true;
			}
			return false;
		}
	};
}

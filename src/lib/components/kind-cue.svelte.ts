/**
 * The kind cue: in a mode that hides markers, a keystroke that turns its block into another kind
 * leaves the new kind's name at the block's corner for a moment and says it once to a screen
 * reader, so the change has a visible cause. Only typed text reports here, never a command.
 */

import { SvelteMap } from 'svelte/reactivity';
import type { AnyBlockKind } from '../core/nodes';
import type { DocumentView } from '../core/node-views';
import { shownKind } from '../core/parsers/heading';
import { blockAccessibleName } from '../a11y-strings';
import { hidesMarkers, type PresentationMode } from '../presentation-mode';
import { blockNodeAt } from '../tree-operations/node-primitives';

export interface KindCue {
	/** Once `write` settles, cue the block at `path` if its shown kind is no longer `before`. */
	afterTypedWrite(
		write: void | Promise<void>,
		path: readonly number[],
		before: AnyBlockKind
	): Promise<void>;
	/** The label the block at `path` shows, until its fade ends or the block there loses that name. */
	labelAt(path: readonly number[]): string | undefined;
	dismiss(path: readonly number[]): void;
}

export interface KindCueDeps {
	getDoc: () => DocumentView;
	getPresentationMode: () => PresentationMode;
	announce: (label: string) => void;
}

export function createKindCue(deps: KindCueDeps): KindCue {
	const labels = new SvelteMap<string, string>();
	const keyOf = (path: readonly number[]) => path.join(',');

	return {
		async afterTypedWrite(write, path, before) {
			await write;
			// Source mode draws the markers that explain the change; reading mode cannot type.
			if (!hidesMarkers(deps.getPresentationMode())) return;
			const after = blockNodeAt(deps.getDoc(), [...path]);
			if (!after || shownKind(after) === before) return;
			const label = blockAccessibleName(after);
			labels.set(keyOf(path), label);
			deps.announce(label);
		},
		// Keyed by path, so the label shows only while the block there still carries that name.
		labelAt(path) {
			const label = labels.get(keyOf(path));
			const node = label === undefined ? undefined : blockNodeAt(deps.getDoc(), [...path]);
			return node && blockAccessibleName(node) === label ? label : undefined;
		},
		dismiss: (path) => void labels.delete(keyOf(path))
	};
}

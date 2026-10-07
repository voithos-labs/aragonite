import type { Rng } from './rng';

/**
 * Which cancelling detours a session runs after its build, drawn in the order they run. No
 * gesture between them draws from the generator, so drawing them up front keeps every seed's
 * picks. A new detour goes last, so the picks of the ones before it stay what each seed made them.
 */

export const FLIP_MODES = ['reading', 'preview-block', 'preview-inline', 'live'] as const;
export const RANGE_DESTROYS = ['backspace', 'delete', 'cut', 'type-over', 'paste-over'] as const;
export const RANGE_BUILDS = ['shift-down', 'shift-click', 'select-all'] as const;

export type FlipMode = (typeof FLIP_MODES)[number];
export type RangeDestroy = (typeof RANGE_DESTROYS)[number];
export type RangeBuild = (typeof RANGE_BUILDS)[number];

export type DetourStep =
	| { kind: 'pause' }
	| { kind: 'select-delete'; chars: number }
	| { kind: 'copy-paste' }
	| { kind: 'reorder' }
	| { kind: 'mode-flip'; mode: FlipMode }
	| { kind: 'cross-block'; destroy: RangeDestroy; build: RangeBuild }
	| { kind: 'merge' }
	// The gesture is picked when the step runs, from the ones the live document can reach.
	| { kind: 'range-interrupt' };

export function planDetours(rng: Rng): DetourStep[] {
	const steps: DetourStep[] = [];
	// Pauses wait out the typing batch, so they vary how undo entries group.
	const maybePause = () => {
		if (rng.chance(0.5)) steps.push({ kind: 'pause' });
	};

	maybePause();
	if (rng.chance(0.7)) steps.push({ kind: 'select-delete', chars: rng.int(3, 6) });
	maybePause();
	if (rng.chance(0.5)) steps.push({ kind: 'copy-paste' });
	maybePause();
	if (rng.chance(0.7)) steps.push({ kind: 'reorder' });
	maybePause();
	if (rng.chance(0.7)) steps.push({ kind: 'mode-flip', mode: rng.pick(FLIP_MODES) });
	maybePause();
	if (rng.chance(0.6)) {
		const destroy = rng.pick(RANGE_DESTROYS);
		steps.push({ kind: 'cross-block', destroy, build: rng.pick(RANGE_BUILDS) });
	}
	maybePause();
	if (rng.chance(0.6)) steps.push({ kind: 'merge' });
	if (rng.chance(0.7)) steps.push({ kind: 'range-interrupt' });
	return steps;
}

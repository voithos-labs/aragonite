import {
	isPasteSurfaceRegistered,
	registerPasteSurface,
	type PasteSurface
} from '$lib/tree-operations/paste-surfaces';

/** Register a built-in kind's paste surface unless its module already did: built-in surfaces
 *  survive the registry reset, so a second registration would throw. */
export function ensurePasteSurface(surface: PasteSurface): void {
	if (!isPasteSurfaceRegistered(surface.kind)) registerPasteSurface(surface);
}

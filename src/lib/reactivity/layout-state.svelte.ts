/**
 * What the editor's heights were measured for: the type scale, the width version the block lists
 * rebuild their tables off, and the viewport-height version, which only changes how many blocks
 * fit. The one place measured heights are thrown away (G4.98): a route reports what changed.
 */

import type { MeasuredHeightOracle } from '../cursor/height-oracle';

export interface LayoutState {
	/** The host's font scale against `HEIGHT_ESTIMATES`. A plain read, since the height estimates
	 *  read it on the keystroke path and the width version already signals the rebuild. */
	typeScale(): number;
	widthVersion(): number;
	viewportHeightVersion(): number;
	/** A document swap or a mode switch: the measured heights belong to a view that's gone. The
	 *  width version stays, since a rebuild would lose the block held in place. */
	forgetMeasuredHeights(): void;
	/** A width change re-wraps every block: the measured heights go, and every list re-estimates
	 *  its table. */
	rebuildForNewGeometry(): void;
	/** A new font scale is a geometry change too. */
	setTypeScale(next: number): void;
	/** The scroll container's height changed; that re-wraps nothing, so every height stays. */
	noteViewportHeight(): void;
}

export interface LayoutStateDeps {
	heightOracle: Pick<MeasuredHeightOracle, 'dropMeasured'>;
}

export function createLayoutState(deps: LayoutStateDeps): LayoutState {
	let typeScale = 1;
	let widthVersion = $state(0);
	let viewportHeightVersion = $state(0);

	function rebuildForNewGeometry(): void {
		deps.heightOracle.dropMeasured();
		widthVersion++;
	}

	return {
		typeScale: () => typeScale,
		widthVersion: () => widthVersion,
		viewportHeightVersion: () => viewportHeightVersion,
		forgetMeasuredHeights: () => deps.heightOracle.dropMeasured(),
		rebuildForNewGeometry,
		setTypeScale(next) {
			typeScale = next;
			rebuildForNewGeometry();
		},
		noteViewportHeight: () => {
			viewportHeightVersion++;
		}
	};
}

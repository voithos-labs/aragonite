/**
 * What the editor's heights were measured for: the type scale, the width version the block lists
 * rebuild their tables off, and the viewport-height version, which only changes how many blocks
 * fit. Layout state builds the height estimator and hands out its reads alone, so it's the one
 * place measured heights can be thrown away (G4.98): a route reports what changed.
 */

import { createHeightOracle, type MeasuredHeightOracle } from '../cursor/height-oracle';
import { HEIGHT_ESTIMATES } from '../cursor/typography-estimates';

export interface LayoutState {
	/** The editor's height estimator, without the drop. */
	heightOracle: Omit<MeasuredHeightOracle, 'dropMeasured'>;
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

export function createLayoutState(): LayoutState {
	let typeScale = 1;
	let widthVersion = $state(0);
	let viewportHeightVersion = $state(0);

	// Only font-relative terms scale; getters, so a scale change needs no new height estimator.
	const oracle = createHeightOracle({
		get lineHeight() {
			return HEIGHT_ESTIMATES.proseLineHeight * typeScale;
		},
		get codeLineHeight() {
			return HEIGHT_ESTIMATES.codeLineHeight * typeScale;
		},
		get avgCharWidth() {
			return HEIGHT_ESTIMATES.avgCharWidth * typeScale;
		},
		blockChrome: HEIGHT_ESTIMATES.blockChrome,
		imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
	});

	function rebuildForNewGeometry(): void {
		oracle.dropMeasured();
		widthVersion++;
	}

	return {
		heightOracle: {
			estimate: oracle.estimate,
			measured: oracle.measured,
			recordMeasured: oracle.recordMeasured,
			measuredIds: oracle.measuredIds
		},
		typeScale: () => typeScale,
		widthVersion: () => widthVersion,
		viewportHeightVersion: () => viewportHeightVersion,
		forgetMeasuredHeights: () => oracle.dropMeasured(),
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

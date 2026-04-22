/**
 * Pure offset translation between a contenteditable's DOM textContent
 * offsets and the underlying raw-content offsets, when a container
 * contributes a read-only ambient prefix before the block's own content.
 *
 * Invariant: textContent === ambientPrefix + raw, so DOM offsets in
 * [0, ambientLength] all map to raw offset 0 (the ambient region is
 * structurally before the raw; clamp there on entry).
 */

export function domToRawOffset(domOffset: number, ambientLength: number): number {
	return Math.max(0, domOffset - ambientLength);
}

export function rawToDomOffset(rawOffset: number, ambientLength: number): number {
	return rawOffset + ambientLength;
}

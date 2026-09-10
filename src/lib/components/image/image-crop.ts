/**
 * Pure math for the image crop: how a `{x, y, z}` window maps to the styles that paint it, and
 * how a pan or a wheel turn moves it. No DOM here beyond a style bag; the properties surface
 * owns the pointer events and `widget-dom.ts` paints a committed crop from the same styles.
 *
 * The model is CSS `background-size: cover` at `z` times the fill scale, with the image point
 * (`x`%, `y`%) pinned to that point of the frame, so `{50, 50, 1}` is a centred cover fit.
 */

import type { ImageCrop } from '../../core/nodes';
import { MAX_CROP_ZOOM } from '../../core/inline/image-dimensions';

export const DEFAULT_CROP: ImageCrop = { x: 50, y: 50, z: 1 };

export interface Size {
	width: number;
	height: number;
}

export function clampCrop(crop: ImageCrop): ImageCrop {
	return {
		x: Math.min(100, Math.max(0, crop.x)),
		y: Math.min(100, Math.max(0, crop.y)),
		z: Math.min(MAX_CROP_ZOOM, Math.max(1, crop.z))
	};
}

/**
 * The styles an `<img>` inside an `overflow: hidden` frame takes. The image box is `z` times
 * the frame with `object-fit: cover`, offset so the pinned point stays put: at `z` 1 the offset
 * is zero and `object-position` alone pans the cover overflow.
 */
export function cropImageStyle(crop: ImageCrop): {
	width: string;
	height: string;
	left: string;
	top: string;
	objectPosition: string;
} {
	const c = clampCrop(crop);
	const pct = (n: number) => `${Math.round(n * 1000) / 1000}%`;
	return {
		width: pct(c.z * 100),
		height: pct(c.z * 100),
		left: pct(-(c.z - 1) * c.x),
		top: pct(-(c.z - 1) * c.y),
		objectPosition: `${pct(c.x)} ${pct(c.y)}`
	};
}

/** The painted image size at this crop: cover-scaled to the frame, then times `z`. */
export function paintedSize(frame: Size, natural: Size, z: number): Size {
	if (natural.width <= 0 || natural.height <= 0)
		return { width: frame.width * z, height: frame.height * z };
	const scale = Math.max(frame.width / natural.width, frame.height / natural.height) * z;
	return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * A drag of (`dx`, `dy`) px moves the window the other way, by the share of the overflow the
 * pointer covered; an axis with nothing to pan on ignores its component.
 */
export function panCrop(
	crop: ImageCrop,
	dx: number,
	dy: number,
	frame: Size,
	natural: Size
): ImageCrop {
	const painted = paintedSize(frame, natural, crop.z);
	const overX = painted.width - frame.width;
	const overY = painted.height - frame.height;
	return clampCrop({
		x: overX > 0.5 ? crop.x - (dx / overX) * 100 : crop.x,
		y: overY > 0.5 ? crop.y - (dy / overY) * 100 : crop.y,
		z: crop.z
	});
}

/** A wheel turn zooms about the pinned point; positive `deltaY` (scrolling down) zooms out. */
export function zoomCrop(crop: ImageCrop, deltaY: number): ImageCrop {
	return clampCrop({ ...crop, z: crop.z - deltaY * 0.002 });
}

export function isDefaultCrop(crop: ImageCrop): boolean {
	return crop.x === 50 && crop.y === 50 && crop.z === 1;
}

/** Paint a crop onto a widget and its image, the way a committed one renders. */
export function applyCropToWidget(
	widget: HTMLElement,
	img: HTMLImageElement,
	frame: Size,
	crop: ImageCrop
): void {
	widget.classList.add('md-image-cropped');
	widget.style.width = `${Math.round(frame.width)}px`;
	widget.style.aspectRatio = `${Math.round(frame.width)} / ${Math.round(frame.height)}`;
	const style = cropImageStyle(crop);
	img.style.width = style.width;
	img.style.height = style.height;
	img.style.left = style.left;
	img.style.top = style.top;
	img.style.objectPosition = style.objectPosition;
	img.style.aspectRatio = '';
}

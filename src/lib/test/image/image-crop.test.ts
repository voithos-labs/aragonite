import { describe, it, expect } from 'vitest';
import {
	DEFAULT_CROP,
	clampCrop,
	cropImageStyle,
	isDefaultCrop,
	paintedSize,
	panCrop,
	zoomCrop
} from '../../components/image/image-crop';

const FRAME = { width: 400, height: 200 };
// Twice as tall as the frame's shape, so the cover fit overflows vertically only.
const TALL = { width: 400, height: 400 };

describe('image crop math', () => {
	it('a default crop is a centred cover fit with no offset', () => {
		expect(cropImageStyle(DEFAULT_CROP)).toEqual({
			width: '100%',
			height: '100%',
			left: '0%',
			top: '0%',
			objectPosition: '50% 50%'
		});
		expect(isDefaultCrop(DEFAULT_CROP)).toBe(true);
	});

	it('zoom scales the image box and offsets it so the pinned point stays put', () => {
		const style = cropImageStyle({ x: 25, y: 100, z: 2 });
		expect(style.width).toBe('200%');
		expect(style.left).toBe('-25%');
		expect(style.top).toBe('-100%');
		expect(style.objectPosition).toBe('25% 100%');
	});

	it('the painted size is the cover fit times the zoom', () => {
		expect(paintedSize(FRAME, TALL, 1)).toEqual({ width: 400, height: 400 });
		expect(paintedSize(FRAME, TALL, 1.5)).toEqual({ width: 600, height: 600 });
		// An unmeasurable image falls back to the frame itself.
		expect(paintedSize(FRAME, { width: 0, height: 0 }, 2)).toEqual({ width: 800, height: 400 });
	});

	it('a pan moves the window against the drag by its share of the overflow', () => {
		// 200px of vertical overflow: dragging down 50px shows 25% more of the top.
		const panned = panCrop(DEFAULT_CROP, 0, 50, FRAME, TALL);
		expect(panned).toEqual({ x: 50, y: 25, z: 1 });
		// No horizontal overflow at zoom 1, so a sideways drag changes nothing.
		expect(panCrop(DEFAULT_CROP, 80, 0, FRAME, TALL).x).toBe(50);
	});

	it('pan and zoom clamp to the frame and the zoom range', () => {
		expect(panCrop(DEFAULT_CROP, 0, -10000, FRAME, TALL).y).toBe(100);
		expect(clampCrop({ x: -5, y: 120, z: 9 })).toEqual({ x: 0, y: 100, z: 4 });
		expect(zoomCrop(DEFAULT_CROP, 1000).z).toBe(1);
		expect(zoomCrop(DEFAULT_CROP, -500).z).toBeCloseTo(2);
	});
});

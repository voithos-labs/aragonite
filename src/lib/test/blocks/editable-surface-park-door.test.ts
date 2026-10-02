// @vitest-environment jsdom
// `parkCaret` clamps every offset, a number or a marker value, into the reachable range, so no
// caller can put a caret behind a hidden marker run; `CURSOR_EXACT_START` is the one exception.
// Source mode hides no marker, so there the clamp does nothing.
// Miss-analysis: e2e covered the marker values per gesture, and no test tried a numeric offset.
import { describe, it, expect, beforeEach } from 'vitest';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';

/** `**bold** tail`: a hidden leading run [0,2) and content out to 13, so [2,13) is reachable. */
function mountBoldLead(mode?: string): SurfaceHarness {
	const harness = makeSurface({ presentationMode: mode });
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.textContent = '**';
	const closer = marker.cloneNode(true);
	harness.el.append(marker, document.createTextNode('bold'), closer, ' tail');
	return harness;
}

beforeEach(() => {
	document.body.innerHTML = '';
});

describe('parkCaret: every offset clamps into the reachable range', () => {
	it('a numeric offset behind a hidden leading run puts the caret at the first reachable offset', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(0);
		expect(harness.seats).toEqual([2]);
	});

	it('a numeric offset inside the reachable range is untouched', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(4);
		expect(harness.seats).toEqual([4]);
	});

	it('the sentinels resolve to the reachable extremes', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(CURSOR_START);
		harness.surface.surface.parkCaret(CURSOR_END);
		expect(harness.seats).toEqual([2, 13]);
	});

	it('source mode is identity for the same offsets: the whole range is reachable', () => {
		const harness = mountBoldLead(undefined);
		harness.surface.surface.parkCaret(0);
		harness.surface.surface.parkCaret(4);
		harness.surface.surface.parkCaret(CURSOR_START);
		expect(harness.seats).toEqual([0, 4, 0]);
	});

	it('CURSOR_EXACT_START puts the caret raw byte 0 even behind a hidden run', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(CURSOR_EXACT_START);
		expect(harness.seats).toEqual([0]);
	});
});

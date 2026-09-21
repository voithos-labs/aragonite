// @vitest-environment jsdom
//
// Where every caret placement clamps: every offset, a number or a marker value, lands inside the
// reachable range, so no caller can put a caret behind a hidden marker run (G2.12). Source mode
// is the same by construction, since the reachable range is the whole range and the clamp does
// nothing; `CURSOR_EXACT_START` is the one declared exception.
// Miss-analysis: the marker-value form was covered per gesture in e2e, so no test could see a
// numeric offset passing through unclamped; the clamp itself had no test of its own.
import { describe, it, expect, beforeEach } from 'vitest';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';

/** `**bold** tail`: a hidden leading run [0,2) and content out to 13, so [2,13) is reachable. */
function mountBoldLead(mode?: string): SurfaceHarness {
	const harness = makeSurface(undefined, undefined, { presentationMode: mode });
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

describe('parkCaret — every offset clamps into the landable range', () => {
	it('a numeric offset behind a hidden leading run seats at the landable start', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(0);
		expect(harness.seats).toEqual([2]);
	});

	it('a numeric offset inside the landable range is untouched', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(4);
		expect(harness.seats).toEqual([4]);
	});

	it('the sentinels resolve to the landable extremes', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(CURSOR_START);
		harness.surface.surface.parkCaret(CURSOR_END);
		expect(harness.seats).toEqual([2, 13]);
	});

	it('source mode is identity for the same offsets — the whole range is landable', () => {
		const harness = mountBoldLead(undefined);
		harness.surface.surface.parkCaret(0);
		harness.surface.surface.parkCaret(4);
		harness.surface.surface.parkCaret(CURSOR_START);
		expect(harness.seats).toEqual([0, 4, 0]);
	});

	it('CURSOR_EXACT_START seats raw byte 0 even behind a hidden run', () => {
		const harness = mountBoldLead('live');
		harness.surface.surface.parkCaret(CURSOR_EXACT_START);
		expect(harness.seats).toEqual([0]);
	});
});

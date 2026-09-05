// @vitest-environment jsdom
//
// The park door's clamp funnel: every offset — numeric or sentinel — seats inside the landable
// range, so no caller can land a caret behind a hidden marker run (G2.12). Source mode proves
// mode-independence by construction: the landable range is the whole range, so the clamp is
// identity with no mode branch in the door. CURSOR_EXACT_START is the one contracted exception.
// Miss-analysis: the sentinel-only door was pinned per gesture (e2e), so no test could observe
// a NUMERIC offset passing the door raw — the door itself had no seat-level contract test.
import { describe, it, expect, beforeEach } from 'vitest';
import { CURSOR_END, CURSOR_EXACT_START, CURSOR_START } from '../../block-component';
import { makeSurface, type SurfaceHarness } from '../harness/editable-surface';

/** `**bold** tail`: a hidden leading run [0,2) and content out to 13 — landable [2,13). */
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

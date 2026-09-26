import { describe, it, expect } from 'vitest';
import { classifyArrivalKey, type EdgeAffinityAction } from '../../cursor/edge-affinity';

// The arrival table decides which of two offsets sharing one pixel a caret means. It depends
// only on the key, so the table is the test. Direction is the rule for single steps: a step
// stops on the side of the run it came from, so a keypress never changes which construct the
// caret is in. It is not the rule for the ends of a line, which are relative to the construct
// and answer `outside` in both directions. Miss-analysis: the table shipped ignoring direction
// (every arrow `inside`) with nothing to contradict it until the e2e rows for typing did.
describe('classifyArrivalKey', () => {
	const MATRIX: Record<string, EdgeAffinityAction> = {
		ArrowLeft: 'far',
		ArrowRight: 'near',
		ArrowUp: 'far',
		ArrowDown: 'near',
		PageUp: 'far',
		PageDown: 'near',
		Home: 'outside',
		End: 'outside',
		Shift: 'preserve',
		Control: 'preserve',
		Alt: 'preserve',
		Meta: 'preserve',
		AltGraph: 'preserve',
		CapsLock: 'preserve',
		a: 'preserve',
		' ': 'preserve',
		é: 'preserve',
		// Astral-plane keys arrive as one code point in two UTF-16 units (GH #122).
		'😀': 'preserve',
		'𝄞': 'preserve',
		Enter: 'reset',
		Tab: 'reset',
		Escape: 'reset',
		Backspace: 'reset',
		Delete: 'reset',
		F5: 'reset',
		Dead: 'reset'
	};

	for (const [key, action] of Object.entries(MATRIX)) {
		it(`${JSON.stringify(key)} → ${action}`, () => {
			expect(classifyArrivalKey(key)).toBe(action);
		});
	}

	// On macOS the caret jumps to the line's edge, which is a placement rather than a step, so
	// the answer is Home and End's, relative to the construct, not the arrow's (GH #124).
	it('meta+ArrowLeft/Right classify as line extremes, not steps', () => {
		expect(classifyArrivalKey('ArrowLeft', true)).toBe('outside');
		expect(classifyArrivalKey('ArrowRight', true)).toBe('outside');
	});

	it('meta leaves the vertical arrows and plain arrows directional', () => {
		expect(classifyArrivalKey('ArrowUp', true)).toBe('far');
		expect(classifyArrivalKey('ArrowLeft', false)).toBe('far');
	});
});

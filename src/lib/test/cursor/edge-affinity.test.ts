import { describe, it, expect } from 'vitest';
import {
	classifyArrivalKey,
	edgeStepDirection,
	type EdgeAffinityAction
} from '../../cursor/edge-affinity';

// The arrival table decides which of two offsets sharing one pixel a caret means. A single step
// stops on the side of the run it came from; the ends of a line answer `outside` both ways.
// Miss-analysis: the table ignored direction, and nothing contradicted it until e2e typing rows.
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
		// Astral-plane keys arrive as one code point in two UTF-16 units.
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
	// the answer is Home and End's, relative to the construct, not the arrow's.
	it('meta+ArrowLeft/Right classify as line extremes, not steps', () => {
		expect(classifyArrivalKey('ArrowLeft', true)).toBe('outside');
		expect(classifyArrivalKey('ArrowRight', true)).toBe('outside');
	});

	it('meta leaves the vertical arrows and plain arrows directional', () => {
		expect(classifyArrivalKey('ArrowUp', true)).toBe('far');
		expect(classifyArrivalKey('ArrowLeft', false)).toBe('far');
	});
});

// Only a plain arrow crosses a hidden edge one boundary at a time; every chord moves by more.
describe('edgeStepDirection', () => {
	const plain = {
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		isComposing: false
	};

	it('steps on a plain horizontal arrow alone', () => {
		expect(edgeStepDirection({ ...plain, key: 'ArrowRight' })).toBe('forward');
		expect(edgeStepDirection({ ...plain, key: 'ArrowLeft' })).toBe('backward');
		expect(edgeStepDirection({ ...plain, key: 'ArrowDown' })).toBeNull();
		expect(edgeStepDirection({ ...plain, key: 'a' })).toBeNull();
	});

	it.each(['shiftKey', 'ctrlKey', 'altKey', 'metaKey', 'isComposing'] as const)(
		'never steps with %s held',
		(flag) => {
			expect(edgeStepDirection({ ...plain, key: 'ArrowRight', [flag]: true })).toBeNull();
		}
	);
});

import { describe, it, expect } from 'vitest';
import {
	classifyArrivalKey,
	createEdgeAffinityState,
	type EdgeAffinityAction
} from '../../cursor/edge-affinity';

// The arrival matrix decides which of two offsets sharing one pixel a caret means. Pure on
// the key, so the table is the test. Direction is the rule for STEPS — one stops on the side of
// the run it approached from, so a press never changes which construct the caret is in — but not
// for line extremes, which are construct-relative and answer `outside` in both directions.
// Miss-analysis: the matrix shipped direction-blind (every arrow `inside`) with no consumer to
// contradict it — the typing seat is the first, and its e2e rows are what caught the polarity.
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
});

describe('createEdgeAffinityState', () => {
	const key = (k: string, altKey = false) => ({ key: k, altKey });

	function primed(from = 'End') {
		const s = createEdgeAffinityState();
		s.note(key(from));
		return s;
	}

	it('produces independent instances', () => {
		const a = createEdgeAffinityState();
		const b = createEdgeAffinityState();
		a.note(key('ArrowRight'));
		expect(a.get()).toBe('near');
		expect(b.get()).toBeNull();
	});

	it('starts with no opinion', () => {
		expect(createEdgeAffinityState().get()).toBeNull();
	});

	it('records the side each arrival means', () => {
		const s = createEdgeAffinityState();
		s.note(key('ArrowRight'));
		expect(s.get()).toBe('near');
		s.note(key('Home'));
		expect(s.get()).toBe('outside');
	});

	// A printable key must not blank the arrival its own write seat is about to read.
	it('a printable key preserves the arrival, and the commit pins it inside', () => {
		const s = primed('Home');
		s.note(key('x'));
		expect(s.get()).toBe('outside');
		s.noteTyping();
		expect(s.get()).toBe('near');
	});

	it('a modifier tap mid-arrow-run keeps the side', () => {
		const s = primed('ArrowRight');
		s.note(key('Shift'));
		expect(s.get()).toBe('near');
	});

	// Alt+Arrow is the block-reorder chord; the reorder's own commit does the clearing.
	it('leaves the side untouched for Alt+Arrow, but not for Alt + another key', () => {
		const s = primed('Home');
		s.note(key('ArrowUp', true));
		expect(s.get()).toBe('outside');
		s.note(key('Escape', true));
		expect(s.get()).toBeNull();
	});

	it('reset clears and is idempotent on a cleared state', () => {
		const s = primed('ArrowLeft');
		s.reset();
		expect(s.get()).toBeNull();
		s.reset();
		expect(s.get()).toBeNull();
	});

	it('notes an arrival again after a reset', () => {
		const s = primed('ArrowLeft');
		s.reset();
		s.note(key('End'));
		expect(s.get()).toBe('outside');
	});
});

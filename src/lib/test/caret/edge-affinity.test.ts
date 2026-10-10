import { describe, it, expect } from 'vitest';
import {
	classifyCaretKey,
	edgeStepDirection,
	type CaretKeyAction
} from '../../caret/edge-affinity';

// Which keys end the caret memory's record at a hidden edge: every key that moves the caret or
// changes the text another way, and none of the keys that type or only hold a modifier.
describe('classifyCaretKey', () => {
	const MATRIX: Record<string, CaretKeyAction> = {
		ArrowLeft: 'navigate',
		ArrowRight: 'navigate',
		ArrowUp: 'navigate',
		ArrowDown: 'navigate',
		PageUp: 'navigate',
		PageDown: 'navigate',
		Home: 'navigate',
		End: 'navigate',
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
		Unidentified: 'preserve',
		Process: 'preserve',
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
			expect(classifyCaretKey(key)).toBe(action);
		});
	}
});

// Only a plain arrow crosses a code chip's border one stop at a time; every chord moves by more.
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

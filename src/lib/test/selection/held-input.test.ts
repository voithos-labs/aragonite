// @vitest-environment jsdom
// Miss-analysis: only an insert was claimed for a selection the editor holds, and no test sent it a
// delete or a break with no key, so a soft keyboard's Backspace edited at the hidden caret.
import { describe, it, expect } from 'vitest';
import { heldInputOf } from '#lib/selection/held-input.js';
import { serialize } from '#lib/core/serializer.js';
import { makeEnv, makeHandlers, selectAcross } from './cross-block/typed-char-env';

const input = (inputType: string, init: InputEventInit = {}) =>
	new InputEvent('beforeinput', { inputType, cancelable: true, ...init });

describe('what an input asks of a selection the editor holds', () => {
	it.each([
		['insertText', { data: 'Z' }, { kind: 'text', text: 'Z' }],
		['deleteContentBackward', {}, { kind: 'delete', direction: 'backward' }],
		['deleteWordBackward', {}, { kind: 'delete', direction: 'backward' }],
		['deleteContentForward', {}, { kind: 'delete', direction: 'forward' }],
		['deleteContent', {}, { kind: 'delete', direction: 'backward' }],
		['insertLineBreak', {}, { kind: 'break', paragraph: false }],
		['insertParagraph', {}, { kind: 'break', paragraph: true }],
		['insertReplacementText', { data: 'word' }, { kind: 'other' }],
		['formatBold', {}, { kind: 'other' }]
	])('%s is the selection’s', (inputType, init, asked) => {
		expect(heldInputOf(input(inputType, init))).toEqual(asked);
	});

	it.each([
		['an IME’s run', 'insertCompositionText', {}],
		['text sent inside a composition', 'insertText', { data: 'Z', isComposing: true }],
		['undo', 'historyUndo', {}],
		['a paste', 'insertFromPaste', {}],
		['a drop', 'insertFromDrop', {}],
		['the delete half of a cut', 'deleteByCut', {}],
		['the delete half of a drag', 'deleteByDrag', {}]
	])('%s is not', (_name, inputType, init) => {
		expect(heldInputOf(input(inputType, init))).toBeNull();
	});
});

describe('input with no key over a range across blocks', () => {
	it.each(['deleteContentBackward', 'deleteContentForward', 'insertLineBreak', 'insertParagraph'])(
		'%s is claimed, and prevented',
		async (inputType) => {
			const env = makeEnv('hello\n\nworld\n');
			selectAcross(env.selectionState, [0], [1]);
			const handlers = makeHandlers(env, [0]);
			const e = input(inputType);
			expect(handlers.claimsBeforeInput(e)).toBe(true);
			void handlers.handleBeforeInput(e);
			expect(e.defaultPrevented).toBe(true);
		}
	);

	it.each(['deleteContentBackward', 'deleteContentForward'])(
		'%s removes the range and nothing beside it',
		async (inputType) => {
			const env = makeEnv('hello\n\nworld\n\nlast\n');
			env.selectionState.enterCrossBlock({ path: [0], offset: 2 }, { path: [1], offset: 3 });
			await makeHandlers(env, [0]).handleBeforeInput(input(inputType));
			expect(serialize(env.deps.doc)).toBe('held\n\nlast\n');
			expect(env.selectionState.ownsRange).toBe(false);
		}
	);

	it.each(['insertReplacementText', 'formatBold', 'insertFromPaste', 'historyUndo'])(
		'%s is left to its own route',
		(inputType) => {
			const env = makeEnv('hello\n\nworld\n');
			selectAcross(env.selectionState, [0], [1]);
			expect(makeHandlers(env, [0]).claimsBeforeInput(input(inputType))).toBe(false);
		}
	);

	it('nothing is claimed with no range held', () => {
		const env = makeEnv('hello\n\nworld\n');
		expect(makeHandlers(env, [0]).claimsBeforeInput(input('deleteContentBackward'))).toBe(false);
	});
});

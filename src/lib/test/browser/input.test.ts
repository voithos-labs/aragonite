// @vitest-environment jsdom
// Miss-analysis: twelve files compared `inputType` strings by hand, so no test said what each
// input type means to the editor, and a new type reached each file as whatever it fell through to.
import { describe, expect, it } from 'vitest';
import {
	decidedDelete,
	isCharacterBackspace,
	isDeleteInput,
	isMoveDelete,
	readInput,
	targetRange,
	type InputIntent
} from '../../browser/input';

const at = (inputType: string) => ({ inputType });

// Every type in Input Events Level 2, plus WebKit's composition commits.
const ROWS: [string, InputIntent][] = [
	['insertText', { kind: 'insert' }],
	['insertReplacementText', { kind: 'replace' }],
	['insertLineBreak', { kind: 'break', paragraph: false }],
	['insertParagraph', { kind: 'break', paragraph: true }],
	['insertCompositionText', { kind: 'compose', final: false }],
	['insertFromComposition', { kind: 'compose', final: true }],
	['historyUndo', { kind: 'history', redo: false }],
	['historyRedo', { kind: 'history', redo: true }],
	['insertFromPaste', { kind: 'transfer', via: 'paste' }],
	['insertFromPasteAsQuotation', { kind: 'transfer', via: 'paste' }],
	['insertFromDrop', { kind: 'transfer', via: 'drop' }],
	['insertFromYank', { kind: 'transfer', via: 'yank' }],
	[
		'deleteContentBackward',
		{ kind: 'delete', decided: { unit: 'character', direction: 'backward' }, source: 'keys' }
	],
	[
		'deleteContentForward',
		{ kind: 'delete', decided: { unit: 'character', direction: 'forward' }, source: 'keys' }
	],
	[
		'deleteWordBackward',
		{ kind: 'delete', decided: { unit: 'word', direction: 'backward' }, source: 'keys' }
	],
	[
		'deleteWordForward',
		{ kind: 'delete', decided: { unit: 'word', direction: 'forward' }, source: 'keys' }
	],
	[
		'deleteSoftLineBackward',
		{ kind: 'delete', decided: { unit: 'soft-line', direction: 'backward' }, source: 'keys' }
	],
	[
		'deleteSoftLineForward',
		{ kind: 'delete', decided: { unit: 'soft-line', direction: 'forward' }, source: 'keys' }
	],
	[
		'deleteHardLineBackward',
		{ kind: 'delete', decided: { unit: 'hard-line', direction: 'backward' }, source: 'keys' }
	],
	[
		'deleteHardLineForward',
		{ kind: 'delete', decided: { unit: 'hard-line', direction: 'forward' }, source: 'keys' }
	],
	['deleteEntireSoftLine', { kind: 'delete', decided: null, source: 'keys' }],
	['deleteContent', { kind: 'delete', decided: null, source: 'keys' }],
	['deleteByCut', { kind: 'delete', decided: null, source: 'move' }],
	['deleteByDrag', { kind: 'delete', decided: null, source: 'move' }],
	['deleteCompositionText', { kind: 'delete', decided: null, source: 'ime' }],
	['deleteByComposition', { kind: 'delete', decided: null, source: 'ime' }],
	['insertOrderedList', { kind: 'other' }],
	['insertUnorderedList', { kind: 'other' }],
	['insertHorizontalRule', { kind: 'other' }],
	['insertLink', { kind: 'other' }],
	['insertTranspose', { kind: 'other' }],
	['formatBold', { kind: 'other' }],
	['formatSetBlockTextDirection', { kind: 'other' }],
	['', { kind: 'other' }],
	['toString', { kind: 'other' }]
];

describe('readInput: what each input type asks for', () => {
	for (const [type, intent] of ROWS) {
		it(`reads ${type || 'an empty type'}`, () => {
			expect(readInput(at(type))).toEqual(intent);
		});
	}

	it('hands every event of a type the same frozen intent, so a read allocates nothing', () => {
		const first = readInput(at('insertText'));
		expect(readInput(at('insertText'))).toBe(first);
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(decidedDelete(at('deleteWordBackward')))).toBe(true);
		expect(readInput(at('formatItalic'))).toBe(readInput(at('insertLink')));
	});
});

describe('the questions about a delete', () => {
	it('decides only the eight deletes that name a side of the caret', () => {
		const decided = ROWS.filter(([type]) => decidedDelete(at(type)) !== null).map(([t]) => t);
		expect(decided).toEqual([
			'deleteContentBackward',
			'deleteContentForward',
			'deleteWordBackward',
			'deleteWordForward',
			'deleteSoftLineBackward',
			'deleteSoftLineForward',
			'deleteHardLineBackward',
			'deleteHardLineForward'
		]);
	});

	it('names only the one-character Backspace as one', () => {
		expect(isCharacterBackspace(at('deleteContentBackward'))).toBe(true);
		expect(isCharacterBackspace(at('deleteContentForward'))).toBe(false);
		expect(isCharacterBackspace(at('deleteWordBackward'))).toBe(false);
	});

	it('counts every delete type as a delete and only a cut or a drag as a move', () => {
		const deletes = ROWS.filter(([type]) => isDeleteInput(at(type))).map(([t]) => t);
		expect(deletes).toEqual(ROWS.map(([t]) => t).filter((t) => t.startsWith('delete')));
		const moves = ROWS.filter(([type]) => isMoveDelete(at(type))).map(([t]) => t);
		expect(moves).toEqual(['deleteByCut', 'deleteByDrag']);
	});
});

describe('targetRange', () => {
	it('reads the first range the event names', () => {
		const range = new StaticRange({
			startContainer: document.body,
			startOffset: 0,
			endContainer: document.body,
			endOffset: 0
		});
		const e = { getTargetRanges: () => [range] } as unknown as InputEvent;
		expect(targetRange(e)).toBe(range);
		expect(targetRange({ getTargetRanges: () => [] } as unknown as InputEvent)).toBeNull();
	});

	it('reads null where the engine has no getTargetRanges', () => {
		expect(targetRange({} as InputEvent)).toBeNull();
	});
});

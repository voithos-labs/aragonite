/**
 * What an input event asks for, read once off its `inputType`: the one place the editor compares
 * one. Every intent is a shared constant, so the read allocates nothing on the typing path; the
 * text an insert carries stays on the event (`e.data`).
 */

export type DeleteDirection = 'backward' | 'forward';

/** How much a delete takes, before the bounds of the line cut it short: a soft line ends where the
 *  text wraps on screen, a hard line at the line ending. */
export type DeleteUnit = 'character' | 'word' | 'soft-line' | 'hard-line';

export interface DeleteIntent {
	unit: DeleteUnit;
	direction: DeleteDirection;
}

export type InputIntent =
	| { readonly kind: 'insert' }
	/** Spellcheck or autocorrect replacing a word. */
	| { readonly kind: 'replace' }
	/** `decided` names what the editor writes itself; null leaves the delete to the browser and
	 *  the read-back. `move` is the delete half of a cut or a drag, `ime` an IME's own. */
	| {
			readonly kind: 'delete';
			readonly decided: Readonly<DeleteIntent> | null;
			readonly source: 'keys' | 'move' | 'ime';
	  }
	| { readonly kind: 'break'; readonly paragraph: boolean }
	/** An IME's text: a run still composing, or the final commit. */
	| { readonly kind: 'compose'; readonly final: boolean }
	| { readonly kind: 'history'; readonly redo: boolean }
	| { readonly kind: 'transfer'; readonly via: 'paste' | 'drop' | 'yank' }
	/** Formatting, lists, links, a transpose, and any type an engine invents. */
	| { readonly kind: 'other' };

type Intent<K extends InputIntent['kind']> = Extract<InputIntent, { kind: K }>;

const intent = <I extends InputIntent>(value: I): I => Object.freeze(value);

const decided = (unit: DeleteUnit, direction: DeleteDirection): Intent<'delete'> =>
	intent({ kind: 'delete', decided: Object.freeze({ unit, direction }), source: 'keys' });

const declined = (source: Intent<'delete'>['source']): Intent<'delete'> =>
	intent({ kind: 'delete', decided: null, source });

const OTHER: InputIntent = intent({ kind: 'other' });
const INSERT: InputIntent = intent({ kind: 'insert' });

const INTENTS: ReadonlyMap<string, InputIntent> = new Map<string, InputIntent>([
	['insertText', INSERT],
	['insertReplacementText', intent({ kind: 'replace' })],
	['insertLineBreak', intent({ kind: 'break', paragraph: false })],
	['insertParagraph', intent({ kind: 'break', paragraph: true })],
	['insertCompositionText', intent({ kind: 'compose', final: false })],
	['insertFromComposition', intent({ kind: 'compose', final: true })],
	['historyUndo', intent({ kind: 'history', redo: false })],
	['historyRedo', intent({ kind: 'history', redo: true })],
	['insertFromPaste', intent({ kind: 'transfer', via: 'paste' })],
	['insertFromPasteAsQuotation', intent({ kind: 'transfer', via: 'paste' })],
	['insertFromDrop', intent({ kind: 'transfer', via: 'drop' })],
	['insertFromYank', intent({ kind: 'transfer', via: 'yank' })],
	['deleteContentBackward', decided('character', 'backward')],
	['deleteContentForward', decided('character', 'forward')],
	['deleteWordBackward', decided('word', 'backward')],
	['deleteWordForward', decided('word', 'forward')],
	['deleteSoftLineBackward', decided('soft-line', 'backward')],
	['deleteSoftLineForward', decided('soft-line', 'forward')],
	['deleteHardLineBackward', decided('hard-line', 'backward')],
	['deleteHardLineForward', decided('hard-line', 'forward')],
	// The two that name no side of the caret.
	['deleteEntireSoftLine', declined('keys')],
	['deleteContent', declined('keys')],
	['deleteByCut', declined('move')],
	['deleteByDrag', declined('move')],
	['deleteCompositionText', declined('ime')],
	['deleteByComposition', declined('ime')]
]);

/** What `e` asks for. */
export function readInput(e: Pick<InputEvent, 'inputType'>): InputIntent {
	// Typing is nine inputs in ten, and the compare is a third the cost of the map's lookup.
	return e.inputType === 'insertText' ? INSERT : (INTENTS.get(e.inputType) ?? OTHER);
}

// ── Questions about one input ───────────────────────────────────────────────

/** What a delete takes when the editor decides it; null for every other input. */
export function decidedDelete(e: Pick<InputEvent, 'inputType'>): Readonly<DeleteIntent> | null {
	const read = readInput(e);
	return read.kind === 'delete' ? read.decided : null;
}

/** Whether `e` is a one-character Backspace, by key or soft keyboard. */
export function isCharacterBackspace(e: Pick<InputEvent, 'inputType'>): boolean {
	const taken = decidedDelete(e);
	return taken?.unit === 'character' && taken.direction === 'backward';
}

/** Whether `e` deletes anything, a cut's, a drag's or an IME's own delete included. */
export function isDeleteInput(e: Pick<InputEvent, 'inputType'>): boolean {
	return readInput(e).kind === 'delete';
}

/** Whether `e` is the delete half of a cut or a drag, which the clipboard or drop owns. */
export function isMoveDelete(e: Pick<InputEvent, 'inputType'>): boolean {
	const read = readInput(e);
	return read.kind === 'delete' && read.source === 'move';
}

/** The first range the browser says `e` will change; null where it names none, or the engine has
 *  no `getTargetRanges` (jsdom). Read only when a caller asks, since it allocates. */
export function targetRange(e: InputEvent): StaticRange | null {
	if (typeof e.getTargetRanges !== 'function') return null;
	return e.getTargetRanges()[0] ?? null;
}

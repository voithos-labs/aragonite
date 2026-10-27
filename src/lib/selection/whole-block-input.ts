/**
 * Tells the hidden editing host behind a block focused as a whole from a real editable. A leaf
 * module, so the selection and editor-actions code that both ask can import it without a cycle.
 */

/** The hidden host looks exactly like a plugin's own editable; this is what tells them apart. */
export const WHOLE_BLOCK_INPUT_ATTR = 'data-whole-block-input';

export function isWholeBlockInputProxy(target: EventTarget | null): boolean {
	return target instanceof Element && target.hasAttribute(WHOLE_BLOCK_INPUT_ATTR);
}

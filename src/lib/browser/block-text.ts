/**
 * A prose block's text read back from its element after the browser edits it: the bytes it
 * shows, its marker prefix left out, and what a heading keeps of its hidden markers.
 */

import {
	markerPrefixOf,
	BLOCK_SUFFIX_ATTR,
	BLOCK_PREFIX_ATTR,
	isHiddenMarkerRoot,
	isAtomicInlineWidget
} from './painted';
import { isBlankText, displayLength } from '../core/lines';
import { domDescendants } from './dom-descendants';
import { widgetSourceRange } from '../core/inline/widget-shell';

/** A block's text read back from its element, and a caret moved onto that text. */
export interface InputRead {
	text: string;
	caret: number;
}

/** The raw bytes `el` shows, its marker prefix left out, and `caret` moved onto them; empty when
 *  only hidden markers are left. `suffix` is the block's structural suffix as rendered. */
export function readContent(
	el: HTMLElement,
	raw: string,
	suffix: string,
	caret: number
): InputRead {
	const prefix = markerPrefixOf(el);
	let out = '';
	let content = '';
	// The hidden `#` marker's length, or null where no hidden marker opens the block.
	let hiddenPrefix: number | null = null;
	for (const child of Array.from(el.childNodes)) {
		if (child === prefix) continue;
		const text = rawTextOfNode(child, raw);
		if (child instanceof Element && isHiddenBlockPrefix(child, el)) {
			out += text;
			hiddenPrefix = text.length;
			continue;
		}
		if (child instanceof Element && child.hasAttribute(BLOCK_SUFFIX_ATTR)) {
			// A key typed over the whole text lands at the start of the structure span.
			const typed = text.endsWith(suffix) ? text.slice(0, text.length - suffix.length) : '';
			out += typed;
			content += typed;
			if (suffixOutlivesEdit(el, child)) out += text.slice(typed.length);
			continue;
		}
		out += text;
		content += text;
	}
	const wasBlank = isBlankText(raw.slice(hiddenPrefix ?? 0, displayLength(raw) - suffix.length));
	const text = keptBlockText({ text: out, content, hidesPrefix: hiddenPrefix !== null, wasBlank });
	if (text === out) return { text, caret };
	return { text, caret: Math.min(Math.max(caret - (hiddenPrefix ?? 0), 0), text.length) };
}

/** What a prose block keeps once an edit leaves `content` between its markers (a hidden `#` marker
 *  not counted, a shown one counted) and `text` in all; the input read-back and the editor's own
 *  delete both ask here. */
export interface EditedBlock {
	text: string;
	content: string;
	hidesPrefix: boolean;
	/** Whether the text between the markers was blank before the edit. */
	wasBlank: boolean;
}

/** A heading's hidden markers belong to its text, so an edit leaving nothing else empties the
 *  block, and blank text typed over the text drops the hidden marker an ATX heading can't keep. */
export function keptBlockText(edited: EditedBlock): string {
	if (edited.content === '') return '';
	if (!edited.hidesPrefix || !isBlankText(edited.content) || edited.wasBlank) return edited.text;
	return edited.content;
}

function isHiddenBlockPrefix(child: Element, el: HTMLElement): boolean {
	return child.hasAttribute(BLOCK_PREFIX_ATTR) && isHiddenMarkerRoot(child, el);
}

/** Whether `el` draws its block's own opening marker (a heading's `#`) as nothing just now. */
export function hidesBlockPrefix(el: HTMLElement): boolean {
	const prefix = el.querySelector(`:scope > [${BLOCK_PREFIX_ATTR}]`);
	return prefix !== null && isHiddenBlockPrefix(prefix, el);
}

// A heading's closing run goes with a hidden `#` marker the browser dropped, since the user saw
// neither; a shown run stays unless it was selected too.
function suffixOutlivesEdit(el: HTMLElement, suffix: Element): boolean {
	if (suffix.getAttribute(BLOCK_SUFFIX_ATTR) !== 'after-prefix') return true;
	const prefix = el.querySelector(`:scope > [${BLOCK_PREFIX_ATTR}]`);
	return (prefix?.textContent ?? '') !== '' || !isHiddenMarkerRoot(suffix, el);
}

/** Raw bytes a DOM subtree stands for: text nodes verbatim, widgets via their source range. */
export function rawTextOfNode(domNode: Node, raw: string): string {
	let out = '';
	for (const node of domDescendants(domNode, isTransparentContainer)) {
		if (node.nodeType === Node.TEXT_NODE) {
			out += node.textContent ?? '';
			continue;
		}
		if (isAtomicInlineWidget(node)) {
			const range = widgetSourceRange(node as Element);
			if (range) out += raw.slice(range.start, range.end);
		}
	}
	return out;
}

/** A node whose own bytes are its children's: a widget stands for its source range instead, and
 *  anything that is neither element nor fragment stands for nothing. */
const isTransparentContainer = (node: Node): boolean =>
	(node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) &&
	!isAtomicInlineWidget(node);

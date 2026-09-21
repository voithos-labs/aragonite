/** The marker DOM the widget-offset suites mount: marker spans, widgets the caret cannot
 *  enter, and a block under one presentation mode. A fixture whose difference from these is a
 *  suite's own subject stays in that suite's file. */

import { CONTENT_EMPTY_ATTR } from '../../cursor/widget-offset';

export interface MountOptions {
	/** Leave a marked block unfocused: its markers then hide like any other block's. */
	unfocused?: boolean;
	mode?: string;
	stamped?: boolean;
}

/** A block element under one presentation mode, holding `parts` in order. */
export function mountBlock(options: MountOptions, ...parts: Node[]): HTMLElement {
	const root = document.createElement('div');
	if (options.mode) root.setAttribute('data-presentation', options.mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	if (options.stamped) block.setAttribute(CONTENT_EMPTY_ATTR, '');
	block.append(...parts);
	root.appendChild(block);
	document.body.appendChild(root);
	// The attribute paints only while the block has focus (the `:focus-within` rule in
	// `editor.css`, which `screenVisibilityOf` mirrors), and a marked fixture is asking about the
	// painted state; the unfocused one is `mountBlock({ stamped: true, unfocused: true })`.
	if (options.stamped && !options.unfocused) block.focus();
	return block;
}

export function span(className: string, text: string): HTMLElement {
	const el = document.createElement('span');
	el.className = className;
	el.textContent = text;
	return el;
}

export function widget(raw: string): HTMLElement {
	const el = document.createElement('span');
	el.setAttribute('data-inline-widget', '');
	el.setAttribute('contenteditable', 'false');
	el.setAttribute('data-source-start', '0');
	el.setAttribute('data-source-end', String(raw.length));
	return el;
}

export const text = (s: string): Text => document.createTextNode(s);

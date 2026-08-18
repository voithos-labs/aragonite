/** The chrome vocabulary the widget-offset walk suites mount: marker spans, atomic
 *  widgets, and a block under one presentation mode. Probe fixtures whose divergence
 *  IS a suite's subject stay in their files. */

import { CONTENT_EMPTY_ATTR } from '../../cursor/widget-offset';

export interface MountOptions {
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

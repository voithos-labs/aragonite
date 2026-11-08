/**
 * Block types drawn with `draw`, for the e2e suite that drives the draw host in a real browser: a
 * `^^field` box holding a two-line field of its own, which takes the caret from a neighbour's arrow
 * and hands it back at its edges, a ```` ```shown ```` fence drawn as a preview until the caret comes
 * in, and a `%>` container drawn as a box around its children. Dev and e2e harness only.
 */

import {
	container,
	definePlugin,
	displayLines,
	fencedBlock,
	lineBlock,
	type BoxDrawContext,
	type ContainerDrawContext,
	type TextDrawContext
} from '#lib/plugin.js';

/** Where the field's caret is, as the e2e suite reads it: its offset and its viewport x. */
export interface FieldCaret {
	offset: number;
	x: number;
}

export const drawnPlugin = definePlugin({
	name: 'drawn',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'field',
				label: 'Field',
				match: /^\^\^field$/,
				sample: '^^field',
				edit: 'box',
				draw: (_block, ctx) => drawField(ctx)
			}),
			fencedBlock({
				name: 'shown',
				label: 'Shown',
				fence: { info: 'shown' },
				sample: '```shown\nhello\n```',
				draw: (block, ctx) => drawShown(block.body, ctx)
			}),
			container({
				name: 'aside',
				label: 'Aside',
				lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
				sample: '%> aside',
				draw: (_block, ctx) => drawAside(ctx)
			})
		]
	})
});

// A preview of the body, hidden while the editor shows the text instead.
function drawShown(body: string, ctx: TextDrawContext) {
	const dom = document.createElement('div');
	const preview = document.createElement('output');
	preview.className = 'drawn-preview';
	dom.append(preview, ctx.source);
	const show = (text: string) => {
		preview.textContent = `preview: ${text.trim()}`;
		preview.hidden = ctx.focused;
	};
	show(body);
	return { dom, update: (next: { body: string }) => show(next.body) };
}

// A bordered box the editor's children go into.
function drawAside(ctx: ContainerDrawContext) {
	const dom = document.createElement('aside');
	dom.className = 'drawn-aside';
	dom.style.cssText = 'border-left: 3px solid; padding-left: 1em;';
	dom.append(ctx.children);
	return { dom };
}

// A monospace field, so a column and an x convert by one character width.
function drawField(ctx: BoxDrawContext) {
	const dom = document.createElement('div');
	dom.className = 'drawn-field';
	const field = document.createElement('textarea');
	field.rows = 2;
	field.value = 'first line here\nsecond line here';
	field.style.cssText = 'font: 16px monospace; padding: 0; border: 0; width: 24ch; resize: none;';
	dom.append(field);

	const charWidth = () => field.getBoundingClientRect().width / 24;
	// A textarea's value always breaks lines with a bare LF.
	const lines = () => displayLines(field.value).map((line) => line.text);
	const lineStart = (line: number) =>
		lines()
			.slice(0, line)
			.reduce((at, text) => at + text.length + 1, 0);
	const caretLine = () => displayLines(field.value.slice(0, field.selectionStart)).length - 1;
	const caretX = () => {
		const column = field.selectionStart - lineStart(caretLine());
		return field.getBoundingClientRect().left + column * charWidth();
	};
	const focused = () => field.matches(':focus');
	const place = (offset: number) => {
		field.focus({ preventScroll: true });
		field.setSelectionRange(offset, offset);
	};

	field.addEventListener('keydown', (e) => {
		if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
		const last = lines().length - 1;
		const at = field.selectionStart;
		const leave = (edge: 'start' | 'end', x?: number) => {
			e.preventDefault();
			ctx.leave(edge, x);
		};
		if (e.key === 'ArrowUp' && caretLine() === 0) leave('start', caretX());
		else if (e.key === 'ArrowDown' && caretLine() === last) leave('end', caretX());
		else if (e.key === 'ArrowLeft' && at === 0) leave('start');
		else if (e.key === 'ArrowRight' && at === field.value.length) leave('end');
	});

	(window as unknown as { __drawnField?: () => FieldCaret | null }).__drawnField = () =>
		focused() ? { offset: field.selectionStart, x: caretX() } : null;

	return {
		dom,
		focus: {
			enter(at: { edge: 'start' | 'end'; x: number | null } | { offset: number }) {
				if ('offset' in at) return place(at.offset);
				const line = at.edge === 'start' ? 0 : lines().length - 1;
				const text = lines()[line];
				const column =
					at.x === null
						? at.edge === 'start'
							? 0
							: text.length
						: Math.round((at.x - field.getBoundingClientRect().left) / charWidth());
				place(lineStart(line) + Math.max(0, Math.min(text.length, column)));
			},
			offset: () => (focused() ? field.selectionStart : null)
		}
	};
}

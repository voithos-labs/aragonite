/**
 * Block types drawn with `draw`, for the e2e suite that drives the draw host in a real browser: a
 * ```` ```field ```` box editing its body in a field of its own, saved as it leaves, a
 * ```` ```shown ```` fence drawn as a preview, a `%>`
 * container drawn as a box, an `@@ ` memo with a badge before its text and a `[[badge]]` box drawn
 * whole. The aside and the badge count their draws on `window.__drawnLog`. Dev and e2e harness only.
 */

import {
	container,
	definePlugin,
	displayLines,
	fencedBlock,
	lineBlock,
	type Block,
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
			fencedBlock({
				name: 'field',
				label: 'Field',
				dragLabel: 'A field box',
				fence: { info: 'field' },
				sample: '```field\nfirst line here\nsecond line here\n```',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: drawField
			}),
			fencedBlock({
				name: 'shown',
				label: 'Shown',
				fence: { info: 'shown' },
				sample: '```shown\nhello\n```',
				insert: { none: 'a test block type' },
				draw: (block, ctx) => drawShown(block.body, ctx)
			}),
			container({
				name: 'aside',
				label: 'Aside',
				lines: { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true },
				sample: '%> aside',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => drawAside(ctx)
			}),
			lineBlock({
				name: 'memo',
				label: 'Memo',
				match: /^@@ (?<text>.*)$/,
				sample: '@@ memo',
				insert: { none: 'a test block type' },
				edit: 'text',
				draw: (_block, ctx) => drawMemo(ctx)
			}),
			lineBlock({
				name: 'badge',
				label: 'Badge',
				match: /^\[\[badge\]\]$/,
				sample: '[[badge]]',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: drawBadge
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
	return { dom, update: () => void count('updates', 'aside') };
}

// A badge drawn before the editor's text, which is never part of it.
function drawMemo(ctx: TextDrawContext) {
	const dom = document.createElement('div');
	dom.className = 'drawn-memo';
	const badge = document.createElement('span');
	badge.textContent = 'memo';
	badge.contentEditable = 'false';
	dom.append(badge, ctx.source);
	return { dom };
}

function drawBadge() {
	const dom = document.createElement('div');
	dom.className = 'drawn-badge';
	dom.textContent = 'a badge drawn whole';
	count('mounts', 'badge');
	return { dom, destroy: () => count('destroys', 'badge') };
}

type DrawnLog = Record<'mounts' | 'updates' | 'destroys', Record<string, number>>;

function count(what: keyof DrawnLog, name: string): void {
	const host = window as unknown as { __drawnLog?: DrawnLog };
	const log = (host.__drawnLog ??= { mounts: {}, updates: {}, destroys: {} });
	log[what][name] = (log[what][name] ?? 0) + 1;
}

// A monospace field, so a column and an x convert by one character width. Leaving it writes its
// text back as the fence's body, at the block's bytes as they are then. It leaves Escape unhandled.
function drawField(block: Block<never>, ctx: BoxDrawContext) {
	const dom = document.createElement('div');
	dom.className = 'drawn-field';
	const field = document.createElement('textarea');
	field.rows = 2;
	const bodyOf = (of: Block<never>) => of.body.replace(/\n$/, '');
	let current = block;
	field.value = bodyOf(block);
	field.addEventListener('blur', () => {
		if (field.value === bodyOf(current)) return;
		const fence = '```field\n' + field.value + '\n```\n';
		void ctx.editor.edit().replace({ from: current.from, to: current.to }, fence).commit();
	});
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
		update(next: Block<never>) {
			current = next;
			if (!focused()) field.value = bodyOf(next);
		},
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

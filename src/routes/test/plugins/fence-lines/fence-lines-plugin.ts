/**
 * Fenced block types for the e2e suite that holds how the editor draws a fenced block's fence
 * lines: a `%%%` block whose text is always shown, its body painted by `renderSource`; a
 * ```` ```math ```` block drawn as a picture that opens its text; and a `%%plain` block with no
 * `draw`. Dev and e2e harness only.
 */

import { definePlugin, fencedBlock, type TextDrawContext } from '#lib/plugin.js';

export const fenceLinesPlugin = definePlugin({
	name: 'fence-lines',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			fencedBlock({
				name: 'fixed',
				label: 'Fixed',
				fence: { open: /^%%%$/, close: '%%%' },
				sample: '%%%\nx\n%%%',
				insert: { none: 'a test block type' },
				edit: 'text',
				draw: (_block, ctx) => placed('fence-fixed', ctx),
				renderSource: paintBody
			}),
			fencedBlock({
				name: 'math',
				label: 'Math',
				fence: { info: 'math' },
				sample: '```math\nx\n```',
				insert: { none: 'a test block type' },
				draw: (block, ctx) => pictured(block.body, ctx)
			}),
			fencedBlock({
				name: 'plain',
				label: 'Plain',
				fence: { open: /^%%plain$/, close: '%%' },
				sample: '%%plain\nx\n%%',
				insert: { none: 'a test block type' }
			})
		]
	})
});

function placed(className: string, ctx: TextDrawContext) {
	const dom = document.createElement('div');
	dom.className = className;
	dom.append(ctx.source);
	return { dom };
}

// A picture of the body, hidden while the editor shows the text instead.
function pictured(body: string, ctx: TextDrawContext) {
	const dom = document.createElement('div');
	const picture = document.createElement('output');
	picture.className = 'fence-math-picture';
	dom.append(picture, ctx.source);
	const show = (text: string) => {
		picture.textContent = `formula: ${text.trim()}`;
		picture.hidden = ctx.focused;
	};
	show(body);
	return { dom, update: (next: { body: string }) => show(next.body) };
}

function paintBody(body: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'fence-fixed-body';
	span.textContent = body;
	return span;
}

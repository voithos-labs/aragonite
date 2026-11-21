/**
 * A table of contents on `depends`, for the e2e suite that drives the key service in a real
 * browser: an `[[outline]]` box with a row per heading, and a click on a row puts the caret in that
 * heading, found through `ctx.editor.doc.blocks`. It logs its draws and updates on
 * `window.__outline`. Dev and e2e harness only.
 */
import { builtin, definePlugin, lineBlock, type Block } from '#lib/plugin.js';

/** What the suite reads: how often the outline drew and updated, and the rows `draw` itself made. */
export interface OutlineLog {
	draws: number;
	updates: number;
	drawn: string[];
}

const log: OutlineLog = { draws: 0, updates: 0, drawn: [] };

const isHeading = (block: Block) =>
	block.is(builtin.blocks.heading) || block.is(builtin.blocks.setextHeading);

/** The guide's key: this block's headings, one `level text` line each. */
function headingsIn(block: Block): string {
	if (!/#|[=-][ \t]*\r?$/m.test(block.text)) return '';
	let lines = '';
	for (const inside of block.walk()) {
		if (inside.is(builtin.blocks.heading) || inside.is(builtin.blocks.setextHeading))
			lines += `${inside.data.level} ${inside.body}\n`;
	}
	return lines;
}

export const outlinePlugin = definePlugin({
	name: 'outline',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'outline',
				label: 'Outline',
				match: /^\[\[outline\]\]$/,
				sample: '[[outline]]',
				insert: { none: 'a test block type' },
				edit: 'box',
				depends: headingsIn,
				draw(_block, ctx) {
					const dom = document.createElement('nav');
					dom.dataset.outline = '';
					// Answer `i` came from top-level block `i`; its `nth` heading is the row's.
					const row = (line: string, i: number, nth: number) => {
						const el = document.createElement('div');
						el.dataset.row = '';
						el.textContent = line.slice(line.indexOf(' ') + 1);
						el.addEventListener('click', () => {
							const block = ctx.editor.doc.blocks[i];
							const heading = block && [...block.walk()].filter(isHeading)[nth];
							if (heading) void ctx.editor.select(heading.from);
						});
						return el;
					};
					const show = (answers: readonly string[]) => {
						dom.replaceChildren();
						answers.forEach((answer, i) =>
							(answer.match(/.+/g) ?? []).forEach((line, nth) => dom.append(row(line, i, nth)))
						);
					};
					show(ctx.depends);
					(window as { __outline?: OutlineLog }).__outline = log;
					log.draws++;
					log.drawn = [...dom.children].map((el) => el.textContent ?? '');
					return {
						dom,
						update(_block, next) {
							show(next.depends);
							log.updates++;
						},
						// A press on a row is the row's, so the box doesn't take whole focus first.
						keep: (event) => event.target instanceof Element && !!event.target.closest('[data-row]')
					};
				}
			})
		]
	})
});

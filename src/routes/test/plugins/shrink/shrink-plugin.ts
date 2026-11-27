/**
 * A folding container on `[shrink]`, `title:` and `[/shrink]` lines whose drawing rebuilds a tall
 * picture on every `update`, reading its width between the clear and the fill as a chart library
 * sizing itself does. The document is a moment shorter, so a drawing at the document's end costs
 * the reader their place unless the editor keeps it. The box counts its updates and says whether
 * the caret is in it (`data-updates`, `data-caret-in`). Dev and e2e harness only.
 */

import { container, definePlugin, fencedLines, type ContainerDrawContext } from '#lib/plugin.js';

interface ShrinkData {
	open: boolean;
}

export const shrinkPlugin = definePlugin({
	name: 'shrink',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container<ShrinkData>({
				name: 'shrink',
				label: 'Shrink',
				lines: fencedLines<ShrinkData>({
					open: /^ {0,3}\[shrink( open)?(?=[\s\]])/i,
					data: (match) => ({ open: match[1] !== undefined }),
					write: (data) => (data.open ? '[shrink open]' : '[shrink]'),
					title: { match: /^title: (?<text>.*)$/, write: (title) => `title: ${title}` },
					close: { match: /^ {0,3}\[\/shrink(?=[\s\]])/i, write: () => '[/shrink]' },
					escape: (line) => line.replace('[', '\\[')
				}),
				interrupts: true,
				closable: {
					closed: (data) => !data.open,
					set: (data, closed) => ({ ...data, open: !closed })
				},
				sample: '[shrink open]\ntitle: T\n\nbody\n\n[/shrink]',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => drawShrink(ctx)
			})
		]
	})
});

function drawShrink(ctx: ContainerDrawContext) {
	const dom = document.createElement('div');
	dom.className = 'shrink-box';
	const toggle = document.createElement('button');
	toggle.className = 'shrink-toggle';
	toggle.type = 'button';
	toggle.contentEditable = 'false';
	toggle.textContent = 'Toggle';
	// The press keeps the caret where it was, as a disclosure toggle does.
	toggle.addEventListener('mousedown', (e) => e.preventDefault());
	toggle.addEventListener('click', () => ctx.setClosed(!ctx.closed));
	let picture = pictureOf(0);
	let updates = 0;
	dom.append(toggle, ctx.children, picture);
	const show = () => {
		toggle.ariaExpanded = String(!ctx.closed);
		dom.dataset.caretIn = String(ctx.focused);
		dom.dataset.updates = String(updates);
	};
	show();
	return {
		dom,
		update() {
			picture.remove();
			picture = pictureOf(dom.clientWidth);
			dom.append(picture);
			updates++;
			show();
		}
	};
}

function pictureOf(width: number): HTMLElement {
	const picture = document.createElement('div');
	picture.className = 'shrink-picture';
	picture.contentEditable = 'false';
	picture.style.cssText =
		'height: 400px; background: repeating-linear-gradient(#8884 0 20px, #0000 0 40px);';
	picture.dataset.width = String(width);
	return picture;
}

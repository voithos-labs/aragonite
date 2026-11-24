/**
 * A container on fenced lines that folds: `[fold]` or `[fold open]`, a `title:` line, the body,
 * `[/fold]`, drawn with a toggle. Each drawing stamps its mount and its draws on its box
 * (`data-mount`, `data-draws`), for a run that counts what a key elsewhere redraws. Dev and e2e
 * harness only.
 */

import { container, definePlugin, fencedLines, type ContainerDrawContext } from '#lib/plugin.js';

interface FoldData {
	open: boolean;
}

let mounts = 0;

export const foldsPlugin = definePlugin({
	name: 'folds',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container<FoldData>({
				name: 'fold',
				label: 'Fold',
				lines: fencedLines<FoldData>({
					open: /^ {0,3}\[fold( open)?(?=[\s\]])/i,
					data: (match) => ({ open: match[1] !== undefined }),
					write: (data) => (data.open ? '[fold open]' : '[fold]'),
					title: { match: /^title: (?<text>.*)$/, write: (title) => `title: ${title}` },
					close: { match: /^ {0,3}\[\/fold(?=[\s\]])/i, write: () => '[/fold]' },
					escape: (line) => line.replace('[', '\\[')
				}),
				interrupts: true,
				closable: {
					closed: (data) => !data.open,
					set: (data, closed) => ({ ...data, open: !closed })
				},
				sample: '[fold]\ntitle: T\n\nbody\n\n[/fold]',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => drawFold(ctx)
			})
		]
	})
});

function drawFold(ctx: ContainerDrawContext) {
	const dom = document.createElement('div');
	dom.className = 'fold-box';
	dom.dataset.mount = String(++mounts);
	let draws = 0;
	const toggle = document.createElement('button');
	toggle.className = 'fold-toggle';
	toggle.type = 'button';
	toggle.contentEditable = 'false';
	toggle.ariaLabel = 'Toggle fold';
	// The press keeps the caret where it was, as a disclosure toggle does.
	toggle.addEventListener('mousedown', (e) => e.preventDefault());
	toggle.addEventListener('click', () => ctx.setClosed(!ctx.closed));
	const paint = () => {
		toggle.ariaExpanded = String(!ctx.closed);
		dom.dataset.draws = String(++draws);
	};
	paint();
	dom.append(toggle, ctx.children);
	return { dom, update: paint };
}

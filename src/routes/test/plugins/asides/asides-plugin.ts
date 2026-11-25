/**
 * Two `:::` container types a plugin value makes on `colonLines`: `:::aside` and `:::margin`, and
 * `:::asides`, whose name starts with the first's. Each names and classes its opening line. Listed
 * alone, the value turns the directive grammar on itself. Each drawing stamps its mount and its
 * draws on its box (`data-mount`, `data-draws`), for a run that counts what a key elsewhere
 * redraws. Dev and e2e harness only.
 */

import { colonLines, container, definePlugin, type ContainerDrawContext } from '#lib/plugin.js';

type ColonData = { name: string };

let mounts = 0;

export const asidesPlugin = definePlugin({
	name: 'asides',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container<ColonData>({
				name: 'aside',
				label: 'Aside',
				role: 'prose',
				lines: colonLines({
					names: ['aside', 'margin'],
					title: { label: 'Heading', className: 'aside-heading' }
				}),
				sample: ':::aside T\nbody\n:::\n',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => drawBox('aside-box', ctx)
			}),
			container<ColonData>({
				name: 'wide',
				label: 'Wide',
				role: 'prose',
				lines: colonLines({
					names: ['asides'],
					title: { label: 'Wide heading', className: 'wide-heading' }
				}),
				sample: ':::asides T\nbody\n:::\n',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => drawBox('wide-box', ctx)
			})
		]
	})
});

function drawBox(className: string, ctx: ContainerDrawContext) {
	const dom = document.createElement('div');
	dom.className = className;
	dom.dataset.mount = String(++mounts);
	let draws = 0;
	const paint = () => void (dom.dataset.draws = String(++draws));
	paint();
	dom.append(ctx.children);
	return { dom, update: paint };
}

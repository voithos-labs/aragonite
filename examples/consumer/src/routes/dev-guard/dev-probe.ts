/**
 * `:::devprobe`: a box that exists only to trip one dev-mode warning through the packaged editor.
 * Its type declares `depends`, and its drawing hands back no `update` to hear the answers, so the
 * editor warns as it draws the box. Dev-guard page only.
 */

import { colonLines, container, definePlugin } from '@voithos-labs/aragonite/plugin';

const devprobe = container({
	name: 'devprobe',
	label: 'Dev probe',
	lines: colonLines({ names: ['devprobe'] }),
	sample: ':::devprobe\nbody\n:::\n',
	insert: { none: 'a dev-guard probe' },
	depends: () => '',
	draw: (_block, ctx) => {
		const dom = document.createElement('div');
		dom.className = 'devprobe-block';
		dom.append(ctx.children);
		return { dom };
	}
});

export const devProbePlugin = definePlugin({
	name: 'devprobe',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [devprobe] })
});

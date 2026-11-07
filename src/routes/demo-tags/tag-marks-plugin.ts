// The showcase's `#tag` plugin on repo source; the tags themselves live in `examples/showcase/`.
import { definePlugin, type EditorPlugin } from '#lib/plugin.js';
import { installTagMarks } from '../../../examples/showcase/tag-marks';

export { TAG_MENU } from '../../../examples/showcase/tag-marks';

export function tagMarksPlugin(): EditorPlugin {
	return definePlugin({
		name: 'harness-tag-marks',
		setup(ctx) {
			ctx.onEditor((editor) => installTagMarks(editor));
		}
	});
}

// The page's plugin, built once the app exists so the blocks render in its context.
import type { App } from 'vue';
import { vueBlockView, vueView } from '@voithos-labs/aragonite-vue';
import { blockViewsPlugin } from '../../../adapter-suite/block-view-kinds';
import Memo from './Memo.vue';
import Label from './Label.vue';
import Box from './Box.vue';
import Note from './Note.vue';
import Chip from './Chip.vue';
import MemoLength from './MemoLength.vue';

export function blockViewPlugins(app: App) {
	return [
		blockViewsPlugin({
			memo: vueBlockView(Memo, { surface: 'leaf', singleLine: true, className: 'memo', app }),
			label: vueBlockView(Label, {
				surface: 'render-primary',
				singleLine: true,
				className: 'label'
			}),
			box: vueBlockView(Box, { surface: 'container', className: 'box' }),
			note: vueBlockView(Note, { surface: 'container', className: 'note' }),
			chip: vueView(Chip, { app }),
			memoLength: vueView(MemoLength, { app })
		})
	];
}

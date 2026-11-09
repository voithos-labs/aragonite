// The page's plugins, built once the app exists so the blocks render in its context.
import type { App } from 'vue';
import { vueBlock, vueView } from '@voithos-labs/aragonite-vue';
import { blockViewsPlugins } from '../../../adapter-suite/block-view-kinds';
import Memo from './Memo.vue';
import Label from './Label.vue';
import Box from './Box.vue';
import Note from './Note.vue';
import Dice from './Dice.vue';
import Chip from './Chip.vue';
import MemoLength from './MemoLength.vue';

export function blockViewPlugins(app: App) {
	return blockViewsPlugins({
		memo: vueBlock(Memo, { className: 'memo', app }),
		label: vueBlock(Label, { className: 'label' }),
		box: vueBlock(Box, { className: 'box' }),
		note: vueBlock(Note, { className: 'note' }),
		dice: vueBlock(Dice, { className: 'dice' }),
		chip: vueView(Chip, { app }),
		memoLength: vueView(MemoLength, { app })
	});
}

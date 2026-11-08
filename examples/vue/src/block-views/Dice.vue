<!-- A die the component draws whole: its button takes the caret, and it rolls in order, since a
     fair die would make a flaky test. ArrowRight rolls it too; ArrowUp and ArrowDown leave it.
     `!! boom` throws. -->
<script setup lang="ts">
import { ref } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { BoxDrawContext } from '@voithos-labs/aragonite/plugin';
import { DICE_BOOM, diceSides } from '../../../adapter-suite/block-view-kinds';

const props = defineProps<BlockProps<never, BoxDrawContext>>();
if (props.block.text.startsWith(DICE_BOOM)) throw new Error('the die went boom');
const rolled = ref(0);
const next = () => (rolled.value = (rolled.value % diceSides(props.block)) + 1);
</script>

<template>
	<button
		class="dice-roll"
		@click="next"
		@keydown.right.prevent="next"
		@keydown.up.prevent="ctx.leave('start')"
		@keydown.down.prevent="ctx.leave('end')"
	>
		d{{ diceSides(block) }}: {{ rolled || 'roll me' }}
	</button>
</template>

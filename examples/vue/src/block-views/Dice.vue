<!-- A die the component draws whole: its button takes the caret, and it rolls in order, since a
     fair die would make a flaky test. ArrowRight rolls it too, an arrow the die keeps. `!! boom`
     throws. -->
<script setup lang="ts">
import { ref } from 'vue';
import { useBlockHandle, type BlockViewProps } from '@voithos-labs/aragonite-vue';
import { DICE_BOOM, diceSides } from '../../../adapter-suite/block-view-kinds';

const props = defineProps<BlockViewProps<'none'>>();
if (props.state.node.raw.startsWith(DICE_BOOM)) throw new Error('the die went boom');
const rolled = ref(0);
const roll = ref<HTMLButtonElement | null>(null);
const next = () => (rolled.value = (rolled.value % diceSides(props.state.node)) + 1);
useBlockHandle(() => ({
	focusable: true,
	focus: () => roll.value?.focus(),
	getCursorOffset: () => (document.activeElement === roll.value ? 0 : null)
}));
</script>

<template>
	<button ref="roll" class="dice-roll" @click="next" @keydown.right.prevent="next">
		d{{ diceSides(state.node) }}: {{ rolled || 'roll me' }}
	</button>
</template>

<!-- The note's text, focused whole, until a double click swaps in a textarea of its own; leaving
     the textarea writes it back, Escape drops the edit. -->
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { BlockProps } from '@voithos-labs/aragonite-vue';
import type { BoxDrawContext } from '@voithos-labs/aragonite/plugin';
import { saveNote } from '../../../adapter-suite/block-view-kinds';

const props = defineProps<BlockProps<never, BoxDrawContext>>();
const editing = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
let dropped = false;

async function openEdit(): Promise<void> {
	editing.value = true;
	await nextTick();
	box.value?.focus();
}

function commit(): void {
	editing.value = false;
	if (dropped) return void (dropped = false);
	const next = box.value!.value;
	if (next + '\n' !== props.block.body) saveNote(props.block, props.ctx, next);
}

function onKeydown(e: KeyboardEvent): void {
	const field = e.currentTarget as HTMLTextAreaElement;
	if (e.key === 'Escape') {
		dropped = true;
		props.ctx.focusWhole();
		editing.value = false;
	} else if (e.key === 'ArrowUp' && !field.value.slice(0, field.selectionStart).includes('\n')) {
		e.preventDefault();
		props.ctx.leave('start');
	}
}
</script>

<template>
	<textarea
		v-if="editing"
		ref="box"
		class="note-source"
		:value="block.body.replace(/\n$/, '')"
		@blur="commit"
		@keydown="onKeydown"
	></textarea>
	<pre v-else class="note-text" @dblclick="openEdit">{{ block.body }}</pre>
</template>

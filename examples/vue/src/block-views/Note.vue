<!-- The note's text, focused whole, until a double click or Mod+M swaps in a textarea of its own;
     leaving the textarea commits it, Escape drops the edit. -->
<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { BlockViewProps } from '@voithos-labs/aragonite-vue';
import { noteText, type NoteHooks } from '../../../adapter-suite/block-view-kinds';

const props = defineProps<BlockViewProps<'container'>>();
const editing = ref(false);
const box = ref<HTMLTextAreaElement | null>(null);
const shown = ref<HTMLPreElement | null>(null);
const text = () => noteText(props.state.node);
let dropped = false;

async function openEdit(): Promise<void> {
	editing.value = true;
	await nextTick();
	box.value?.focus();
}
props.ctx.container.setCommandHooks({ openEdit: () => void openEdit() } satisfies NoteHooks);

function attachBox(el: unknown): void {
	box.value = el as HTMLTextAreaElement | null;
	props.ctx.container.attachFocus(box.value);
}
function attachShown(el: unknown): void {
	shown.value = el as HTMLPreElement | null;
	if (shown.value) props.ctx.container.attachFocus(shown.value);
}

function commit(): void {
	if (dropped) return void (dropped = false);
	const next = box.value!.value + '\n';
	editing.value = false;
	if (next !== text()) void props.ctx.container.updateOwnMetadata({ text: next });
}

async function onKeydown(e: KeyboardEvent): Promise<void> {
	if (e.key === 'Escape') {
		e.preventDefault();
		dropped = true;
		editing.value = false;
		await nextTick();
		shown.value?.focus();
	} else if (
		atEdge(e.currentTarget as HTMLTextAreaElement, e.key) &&
		props.ctx.container.moveFocusOut(e)
	) {
		e.preventDefault();
	}
}

// The caret on the textarea's first line for ArrowUp, its last for ArrowDown.
function atEdge(el: HTMLTextAreaElement, key: string): boolean {
	if (el.selectionStart !== el.selectionEnd) return false;
	if (key === 'ArrowUp') return !el.value.slice(0, el.selectionStart).includes('\n');
	if (key === 'ArrowDown') return !el.value.slice(el.selectionStart).includes('\n');
	return false;
}
</script>

<template>
	<textarea
		v-if="editing"
		:ref="attachBox"
		class="note-source"
		:value="text().replace(/\n$/, '')"
		@blur="commit"
		@keydown="onKeydown"
	></textarea>
	<pre v-else :ref="attachShown" class="note-text" tabindex="-1" @dblclick="openEdit">{{
		text()
	}}</pre>
</template>

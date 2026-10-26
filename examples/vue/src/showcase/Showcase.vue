<!-- The showcase in Vue: the shell around `examples/showcase/`, which holds the document, the
     plugins, the controls and the top bar the Svelte and React showcases share. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watchEffect } from 'vue';
import { Aragonite, type AragoniteInstance } from '@voithos-labs/aragonite-vue';
import SHOWCASE_DOCUMENT from '../../../showcase/showcase-content.md?raw';
import { INITIAL_STATE, showsSelectionMenu } from '../../../showcase/controls';
import {
	mountShowcaseBar,
	type ShowcaseBar,
	type ShowcaseBarState,
	type ToggleKey
} from '../../../showcase/top-bar';
import { showcasePlugins } from '../../../showcase/plugins';
import { readTheme, toggleTheme } from '../../../showcase/theme';
import { demoPasteImage, resolveDemoImageUrl } from '../../../showcase/image-store';

const CHANGELOG_URL = 'https://github.com/voithos-labs/aragonite/blob/main/docs/changelog.md';

const source = ref(SHOWCASE_DOCUMENT);
const theme = ref(readTheme());
const presentationMode = ref(INITIAL_STATE.presentationMode);
const dragHandles = ref(INITIAL_STATE.dragHandles);
const selectionMenu = ref(INITIAL_STATE.selectionMenu);
const occurrences = ref(INITIAL_STATE.occurrences);
const showSource = ref(INITIAL_STATE.showSource);
const editor = shallowRef<AragoniteInstance | null>(null);
const header = shallowRef<HTMLElement | null>(null);

const barState = computed<ShowcaseBarState>(() => ({
	mode: presentationMode.value,
	pressed: {
		theme: theme.value === 'dark',
		dragHandles: dragHandles.value,
		selectionMenu: selectionMenu.value,
		occurrences: occurrences.value,
		source: showSource.value
	}
}));

const flips: Partial<Record<ToggleKey, () => void>> = {
	theme: () => (theme.value = toggleTheme(theme.value)),
	dragHandles: () => (dragHandles.value = !dragHandles.value),
	selectionMenu: () => (selectionMenu.value = !selectionMenu.value),
	occurrences: () => (occurrences.value = !occurrences.value),
	source: () => (showSource.value = !showSource.value)
};

let bar: ShowcaseBar | null = null;
onMounted(() => {
	bar = mountShowcaseBar(
		header.value!,
		{
			framework: 'Vue',
			changelogHref: CHANGELOG_URL,
			tools: ['source'],
			onMode: (mode) => (presentationMode.value = mode),
			onToggle: (key) => flips[key]?.(),
			editor: () => editor.value?.handle
		},
		barState.value
	);
});
// Read before the mount check, so the watcher tracks the state from its first run.
watchEffect(() => {
	const state = barState.value;
	bar?.update(state);
});
onBeforeUnmount(() => bar?.destroy());
</script>

<template>
	<div class="showcase aragonite-editor-theme" :data-editor-theme="theme">
		<header ref="header" class="showcase-header"></header>
		<div class="showcase-body">
			<!-- The plugin set is read at mount, so the occurrences toggle remounts the editor; the
			     bound document carries across. -->
			<Aragonite
				:key="String(occurrences)"
				ref="editor"
				v-model="source"
				class="showcase-editor"
				:plugins="showcasePlugins(occurrences)"
				:block-drag-handles="dragHandles"
				:on-paste-image="demoPasteImage"
				:resolve-image-url="resolveDemoImageUrl"
				:presentation-mode="presentationMode"
				link-click="plain"
				:selection-toolbar="showsSelectionMenu(presentationMode, selectionMenu)"
				:theme="theme"
			/>
			<pre v-if="showSource" class="showcase-source" data-testid="source-view">{{ source }}</pre>
		</div>
	</div>
</template>

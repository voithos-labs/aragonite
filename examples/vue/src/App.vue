<!-- The adapter suite's page contract (`examples/adapter-suite/requirements/page-contract.md`). -->
<script setup lang="ts">
import { ref, version } from 'vue';
import { Aragonite, type AragoniteInstance } from '@voithos-labs/aragonite-vue';
import type { PluginError } from '@voithos-labs/aragonite';
import { highlight } from '@voithos-labs/aragonite-highlight';
import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';

defineProps<{ uncontrolled: boolean }>();

const FIRST = '# First note\n\nHello from the first note.\n';
const SECOND = '# Second note\n\nA different document.\n';
const LONG = Array.from({ length: 300 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n') + '\n';
// A grammar loaded with the page, and one fetched when a fence first names it.
const CODE = '```js\nconst a = 1;\n```\n\n```rust\nfn main() {}\n```\n';
// Code fences highlight as they did when the editor bundled its own grammars.
const plugins = [highlight({ renderer: highlightJs() })];

function reportError(error: PluginError) {
	console.error(`${error.plugin} failed to ${error.doing}`, error.cause);
}

const loaded = ref(FIRST);
const value = ref(FIRST);
const theme = ref('light');
const themed = ref(true);
const shown = ref(true);
const editor = ref<AragoniteInstance | null>(null);
const readOut = ref('');

function load() {
	loaded.value = SECOND;
	value.value = SECOND;
}
</script>

<template>
	<main>
		<p data-testid="framework-version">{{ version }}</p>
		<button data-testid="load" @click="load">Load another doc</button>
		<button data-testid="load-long" @click="value = LONG">Load a long doc</button>
		<button data-testid="load-code" @click="value = CODE">Load a code doc</button>
		<button data-testid="revert" @click="value = loaded">Revert</button>
		<button data-testid="theme" @click="theme = theme === 'light' ? 'dark' : 'light'">Theme</button>
		<button data-testid="drop-theme" @click="themed = !themed">
			{{ themed ? 'Drop theme' : 'Pass theme' }}
		</button>
		<button data-testid="unmount" @click="shown = !shown">{{ shown ? 'Unmount' : 'Mount' }}</button>
		<button data-testid="read" @click="readOut = editor?.handle?.getSource() ?? ''">Read</button>
		<Aragonite
			v-if="shown"
			ref="editor"
			v-bind="uncontrolled ? { defaultValue: FIRST } : { modelValue: value }"
			:theme="themed ? theme : undefined"
			:plugins="plugins"
			:on-error="reportError"
			style="height: 60vh"
			@update:model-value="value = $event"
		>
			<template #header><input data-testid="header-input" placeholder="Title" /></template>
		</Aragonite>
		<pre data-testid="mirror">{{ value }}</pre>
		<pre data-testid="read-out">{{ readOut }}</pre>
	</main>
</template>

<script lang="ts">
	import Section from './Section.svelte';
	import { createPanelState, type SectionKey } from './panel-state.svelte';

	interface Props {
		rawSource: string;
		onRawSourceChange: (value: string) => void;
		getCst: () => string;
		getSelection: () => string;
		getUndoStack: () => string;
		getInlineTree: () => string;
		getOpsLog: () => string;
		opsLogTick: number;
	}
	let {
		rawSource,
		onRawSourceChange,
		getCst,
		getSelection,
		getUndoStack,
		getInlineTree,
		getOpsLog,
		opsLogTick
	}: Props = $props();

	const panel = createPanelState();

	let rawBuffer = $state(rawSource);
	$effect(() => {
		rawBuffer = rawSource;
	});

	let rawDebounceTimer: number | null = null;
	function onRawInput(ev: Event) {
		const value = (ev.target as HTMLTextAreaElement).value;
		rawBuffer = value;
		if (rawDebounceTimer !== null) clearTimeout(rawDebounceTimer);
		rawDebounceTimer = window.setTimeout(() => {
			onRawSourceChange(rawBuffer);
			rawDebounceTimer = null;
		}, 200);
	}

	const cstText = $derived(getCst());
	const selectionText = $derived(getSelection());
	const undoText = $derived(getUndoStack());
	const inlineText = $derived(getInlineTree());
	// opsLogTick read inside $derived.by so a log update triggers re-read.
	const opsLogText = $derived.by(() => {
		opsLogTick;
		return getOpsLog();
	});

	function handleKeyDown(e: KeyboardEvent) {
		const modifier = e.ctrlKey || e.metaKey;
		if (modifier && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
			e.preventDefault();
			panel.toggle();
		} else if (e.key === 'Escape' && panel.open) {
			const target = e.target as Element | null;
			if (target?.closest('.debug-panel')) {
				e.preventDefault();
				panel.open = false;
			}
		}
	}

	async function onCopyAll() {
		const sections = [
			['Raw source', rawBuffer],
			['CST', cstText],
			['Selection', selectionText],
			['Undo stack', undoText],
			['Inline tree', inlineText],
			['Operations log', opsLogText]
		] as const;
		const timestamp = new Date().toISOString();
		const body = sections
			.map(([title, content]) => `### ${title}\n\n\`\`\`\n${content || '(empty)'}\n\`\`\``)
			.join('\n\n');
		const blob = `# Debug snapshot — ${timestamp}\n\n${body}\n`;
		await navigator.clipboard.writeText(blob);
	}

	function mkToggle(key: SectionKey) {
		return () => panel.toggleSection(key);
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if panel.open}
	<aside class="debug-panel" tabindex="-1">
		<header class="debug-panel-header">
			<span class="debug-panel-title">Debug</span>
			<button type="button" class="copy-all" onclick={onCopyAll}>Copy all as text</button>
			<button type="button" class="close-btn" onclick={() => (panel.open = false)} aria-label="Close">×</button>
		</header>
		<Section title="Raw source" expanded={panel.isExpanded('rawSource')} onToggle={mkToggle('rawSource')}>
			<textarea class="raw-source" value={rawBuffer} oninput={onRawInput} spellcheck={false}></textarea>
		</Section>
		<Section title="CST tree" expanded={panel.isExpanded('cst')} onToggle={mkToggle('cst')}>
			{cstText}
		</Section>
		<Section title="Selection" expanded={panel.isExpanded('selection')} onToggle={mkToggle('selection')}>
			{selectionText}
		</Section>
		<Section title="Undo stack" expanded={panel.isExpanded('undo')} onToggle={mkToggle('undo')}>
			{undoText}
		</Section>
		<Section title="Inline tree (focused block)" expanded={panel.isExpanded('inline')} onToggle={mkToggle('inline')}>
			{inlineText}
		</Section>
		<Section title="Operations log" expanded={panel.isExpanded('opsLog')} onToggle={mkToggle('opsLog')}>
			{opsLogText}
		</Section>
	</aside>
{/if}

<style>
	.debug-panel {
		position: fixed;
		top: 0;
		right: 0;
		width: 420px;
		height: 100vh;
		background: var(--debug-bg, #1e1e1e);
		color: var(--debug-fg, #ddd);
		border-left: 1px solid var(--debug-divider, #2a2a2a);
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		z-index: 9999;
		font-size: 12px;
	}
	.debug-panel-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--debug-divider, #2a2a2a);
		background: var(--debug-header-bg, #252525);
	}
	.debug-panel-title {
		flex: 1;
		font-weight: 600;
	}
	.copy-all,
	.close-btn {
		all: unset;
		padding: 2px 8px;
		cursor: pointer;
		border-radius: 3px;
		color: var(--debug-fg, #ddd);
	}
	.copy-all:hover,
	.close-btn:hover {
		background: rgba(255, 255, 255, 0.08);
	}
	.close-btn {
		font-size: 18px;
		line-height: 1;
	}
	.raw-source {
		width: 100%;
		min-height: 120px;
		background: var(--debug-input-bg, #252525);
		color: inherit;
		border: 1px solid var(--debug-divider, #2a2a2a);
		border-radius: 3px;
		padding: 6px 8px;
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		line-height: 1.4;
		resize: vertical;
	}
</style>

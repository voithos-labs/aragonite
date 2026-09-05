<script lang="ts">
	import Section from './Section.svelte';
	import { type createPanelState, MIN_PANEL_WIDTH, type SectionKey } from './panel-state.svelte';
	import { enableInteractionTrace } from '$lib/debug/interaction-trace';

	interface Props {
		/** Owned by the mounting route, so a header affordance and Ctrl+Shift+D share one state. */
		panel: ReturnType<typeof createPanelState>;
		rawSource: string;
		getCst: () => string;
		getSelection: () => string;
		getUndoStack: () => string;
		getInlineTree: () => string;
		getOpsLog: () => string;
		getTrace: () => string;
		opsLogTick: number;
	}
	let {
		panel,
		rawSource,
		getCst,
		getSelection,
		getUndoStack,
		getInlineTree,
		getOpsLog,
		getTrace,
		opsLogTick
	}: Props = $props();

	const cstText = $derived(getCst());
	const selectionText = $derived(getSelection());
	const undoText = $derived(getUndoStack());
	const inlineText = $derived(getInlineTree());
	// opsLogTick read inside $derived.by so a log update triggers re-read.
	const opsLogText = $derived.by(() => {
		void opsLogTick;
		return getOpsLog();
	});
	const traceText = $derived.by(() => {
		void opsLogTick;
		return getTrace();
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
			['Raw source', rawSource],
			['CST', cstText],
			['Selection', selectionText],
			['Undo stack', undoText],
			['Inline tree', inlineText],
			['Operations log', opsLogText],
			['Interaction trace', traceText]
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

	// The interaction trace ships default-off; expanding its section is the dev's opt-in,
	// and it stays armed for the session rather than re-enabling per keystroke.
	function toggleTrace() {
		if (!panel.isExpanded('trace')) enableInteractionTrace();
		panel.toggleSection('trace');
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	let resizing = $state(false);
	let startX = 0;
	let startWidth = 0;

	function onHandleMouseDown(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		startX = e.clientX;
		startWidth = panel.width;
	}

	function onMouseMove(e: MouseEvent) {
		if (!resizing) return;
		const delta = startX - e.clientX;
		const maxWidth = window.innerWidth * 0.5;
		const next = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, startWidth + delta));
		panel.setWidth(next);
	}

	function onMouseUp() {
		resizing = false;
	}
</script>

<svelte:window onkeydown={handleKeyDown} onmousemove={onMouseMove} onmouseup={onMouseUp} />

{#if panel.open}
	<aside class="debug-panel" class:resizing tabindex="-1" style:width="{panel.width}px">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="resize-handle"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize debug panel"
			onmousedown={onHandleMouseDown}
		></div>
		<header class="debug-panel-header">
			<span class="debug-panel-title">Debug</span>
			<button type="button" class="copy-all" onclick={onCopyAll}>Copy all as text</button>
			<button
				type="button"
				class="close-btn"
				onclick={() => (panel.open = false)}
				aria-label="Close">×</button
			>
		</header>
		<Section
			title="Raw source"
			expanded={panel.isExpanded('rawSource')}
			onToggle={mkToggle('rawSource')}
		>
			{rawSource}
		</Section>
		<Section title="CST tree" expanded={panel.isExpanded('cst')} onToggle={mkToggle('cst')}>
			{cstText}
		</Section>
		<Section
			title="Selection"
			expanded={panel.isExpanded('selection')}
			onToggle={mkToggle('selection')}
		>
			{selectionText}
		</Section>
		<Section title="Undo stack" expanded={panel.isExpanded('undo')} onToggle={mkToggle('undo')}>
			{undoText}
		</Section>
		<Section
			title="Inline tree (focused block)"
			expanded={panel.isExpanded('inline')}
			onToggle={mkToggle('inline')}
		>
			{inlineText}
		</Section>
		<Section
			title="Operations log"
			expanded={panel.isExpanded('opsLog')}
			onToggle={mkToggle('opsLog')}
		>
			{opsLogText}
		</Section>
		<Section title="Interaction trace" expanded={panel.isExpanded('trace')} onToggle={toggleTrace}>
			{traceText || '(recording — interact to capture inline transitions)'}
		</Section>
	</aside>
{/if}

<style>
	.debug-panel {
		position: fixed;
		top: 0;
		right: 0;
		height: 100vh;
		background: var(--color-bg-elevated, #2a2c33);
		color: var(--color-text-secondary, #d6d9e0);
		border-left: 1px solid var(--color-border, #3d4047);
		display: flex;
		flex-direction: column;
		/* Both axes stated: `overflow-y: auto` alone computes the other to auto per CSS, and
		   the resize-handle's negative-left 3px then shows a horizontal scrollbar. */
		overflow-x: hidden;
		overflow-y: auto;
		z-index: 9999;
		font-size: 12px;
	}
	.debug-panel.resizing,
	.debug-panel.resizing :global(*) {
		user-select: none;
		cursor: ew-resize !important;
	}
	.resize-handle {
		position: absolute;
		top: 0;
		left: -3px;
		width: 6px;
		height: 100%;
		cursor: ew-resize;
		z-index: 10000;
		background: transparent;
		transition: background-color 120ms ease;
	}
	.resize-handle:hover,
	.debug-panel.resizing .resize-handle {
		background: rgba(100, 160, 255, 0.35);
	}
	.debug-panel-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border, #3d4047);
		background: var(--color-bg-secondary, rgba(128, 128, 128, 0.12));
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
		color: var(--color-text-secondary, #d6d9e0);
	}
	.copy-all:hover,
	.close-btn:hover {
		background: var(--color-ui-faint, rgba(255, 255, 255, 0.07));
	}
	.close-btn {
		font-size: 18px;
		line-height: 1;
	}
	/* Custom scrollbars — unified across panel and section bodies. */
	.debug-panel,
	.debug-panel :global(.debug-section-body) {
		scrollbar-width: thin;
		scrollbar-color: var(--color-ui-muted, #a4a4a4) transparent;
	}
	.debug-panel::-webkit-scrollbar,
	.debug-panel :global(.debug-section-body)::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	.debug-panel::-webkit-scrollbar-track,
	.debug-panel :global(.debug-section-body)::-webkit-scrollbar-track {
		background: transparent;
	}
	.debug-panel::-webkit-scrollbar-thumb,
	.debug-panel :global(.debug-section-body)::-webkit-scrollbar-thumb {
		background: var(--color-ui-muted, #a4a4a4);
		border-radius: 4px;
	}
	.debug-panel::-webkit-scrollbar-thumb:hover,
	.debug-panel :global(.debug-section-body)::-webkit-scrollbar-thumb:hover {
		background: var(--color-ui-dulled, #afb1b3);
	}
	.debug-panel::-webkit-scrollbar-corner,
	.debug-panel :global(.debug-section-body)::-webkit-scrollbar-corner {
		background: transparent;
	}
</style>

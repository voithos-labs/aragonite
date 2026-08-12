<script module lang="ts">
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { detailsPlugin } from '$lib/plugins/details';
	import { emojiPlugin } from '$lib/plugins/emoji';
	import { footnotesPlugin } from '$lib/plugins/footnotes';
	import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
	import { latexPlugin } from '$lib/plugins/latex';
	import { katexRenderer } from '$lib/plugins/latex/renderer';
	import { mermaidPlugin } from '$lib/plugins/mermaid';
	import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';
	import { tocPlugin } from '$lib/plugins/toc';

	// The full bundled set, so the host palette is judged with every plugin's chrome installed.
	const BUNDLED_PLUGINS = [
		admonitionsPlugin(),
		detailsPlugin(),
		emojiPlugin(),
		footnotesPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		mermaidPlugin({ renderer: mermaidRenderer }),
		tocPlugin(),
		highlightOccurrencesPlugin()
	];
</script>

<script lang="ts">
	import { Editor, type PresentationMode } from '$lib';
	import { trackParityDocument } from '../../parity-documents.svelte';

	/**
	 * The themed-host embed: host-chrome tokens declared on the page wrapper and NO
	 * `.aragonite-editor-theme` anywhere, so the editor consumes a host cascade the way an
	 * app's own theme system feeds it. The token vocabulary mirrors the first integration's.
	 */

	interface HostTheme {
		name: string;
		type: 'dark' | 'light';
		vars: Record<string, string>;
	}

	const THEMES: Record<string, HostTheme> = {
		'slate-dark': {
			name: 'Slate Dark',
			type: 'dark',
			vars: {
				'color-bg': '#2d3033',
				'color-surface': '#1a1c1d',
				'color-border': '#3a3d40',
				'color-text-primary': '#ffffff',
				'color-text-secondary': '#e6e5e5',
				'color-ui-dulled': '#afb1b3',
				'color-ui-muted': '#a4a4a4',
				'color-accent': '#567b67',
				'color-error': '#ff5f57'
			}
		},
		'warm-dark': {
			name: 'Warm Dark',
			type: 'dark',
			vars: {
				'color-bg': '#2c2c2a',
				'color-surface': '#1a1a19',
				'color-border': '#3e3e3b',
				'color-text-primary': '#e8e8e5',
				'color-text-secondary': '#cfcfca',
				'color-ui-dulled': '#a3a39d',
				'color-ui-muted': '#8f8f89',
				'color-accent': '#567b67',
				'color-error': '#ff5f57'
			}
		},
		'paper-light': {
			name: 'Paper Light',
			type: 'light',
			vars: {
				'color-bg': '#ece6e9',
				'color-surface': '#ffffff',
				'color-border': '#d0ccd0',
				'color-text-primary': '#000000',
				'color-text-secondary': '#232325',
				'color-ui-dulled': '#5c5f62',
				'color-ui-muted': '#787a7c',
				'color-accent': '#567b67',
				'color-error': '#d03025'
			}
		},
		'warm-light': {
			name: 'Warm Light',
			type: 'light',
			vars: {
				'color-bg': '#dfddd7',
				'color-surface': '#efeee9',
				'color-border': '#c9c7c0',
				'color-text-primary': '#2a2a27',
				'color-text-secondary': '#4a4a45',
				'color-ui-dulled': '#71716a',
				'color-ui-muted': '#83837b',
				'color-accent': '#567b67',
				'color-error': '#d03025'
			}
		}
	};

	/** Per-mode accent hexes; 'default' keeps the theme's own. */
	const ACCENTS: Record<string, { light: string; dark: string }> = {
		slate: { light: '#5b7286', dark: '#6d8ba3' },
		violet: { light: '#75689a', dark: '#8d7fb5' },
		copper: { light: '#c56836', dark: '#c56836' },
		amber: { light: '#a3812f', dark: '#c2a04a' },
		rose: { light: '#a05e72', dark: '#b87990' },
		teal: { light: '#3f7f7a', dark: '#569a94' },
		mono: { light: '#5c5c5c', dark: '#9a9a9a' }
	};

	const MODES: readonly { value: PresentationMode; label: string }[] = [
		{ value: 'source', label: 'Source' },
		{ value: 'preview-inline', label: 'Live' },
		{ value: 'reading', label: 'Reading' }
	];

	let themeKey = $state('slate-dark');
	let accentKey = $state('default');
	let mode = $state<PresentationMode>('preview-inline');
	let editor = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => editor);

	const theme = $derived(THEMES[themeKey]);
	const accent = $derived(
		accentKey === 'default' ? theme.vars['color-accent'] : ACCENTS[accentKey][theme.type]
	);
	const hostStyle = $derived(
		[
			...Object.entries(theme.vars).map(([k, v]) => `--${k}: ${v}`),
			`--color-accent: ${accent}`,
			`--font-editor: 'Cascadia Code', 'Cascadia Mono', 'Consolas', ui-monospace, monospace`,
			`--font-ui: ui-sans-serif, system-ui, sans-serif`,
			`--page-max-width: 1200px`
		].join('; ')
	);

	const DOC = `A themed host declares the chrome tokens and the editor reads them — no bridge stylesheet, no opt-in class.

**What this page is for**

- [ ] tune the editor's look against a host palette
- [x] host tokens flowing from the page wrapper, not the opt-in class
- [ ] both modes, all four themes, every accent

## Structure

> A quote takes the muted tint, and the chrome around it never reaches for the accent.

At rest the accent shows up in three places here: [inline links](https://example.com), the text of a [reference link][ref], and a footnote marker[^accent]. Swap it from the picker and those are what move.

| Theme | Surface | Accent |
| ----- | ------- | ------ |
| Slate Dark | \`#1a1c1d\` | green |
| Warm Light | \`#efeee9\` | green |

\`\`\`ts
const scale = 14; // the host's editor type scale, inherited from the wrapper
\`\`\`

Some inline math $e^{i\\pi} + 1 = 0$ and an emoji :sparkles: for good measure.

---

:::note
An admonition picks its own palette; only the chrome around it is the host's.
:::

[^accent]: A footnote marker is the accent's only appearance outside a link, so an accent swap stays legible with nothing hovered.

[ref]: https://example.com/reference
`;

	let source = $state(DOC);
</script>

<svelte:head>
	<title>themed host embed</title>
</svelte:head>

<div class="host-page" style={hostStyle}>
	<header class="shell-bar">
		<span class="shell-name">themed host embed</span>
		<div class="pickers">
			<select bind:value={themeKey} aria-label="Theme">
				{#each Object.entries(THEMES) as [key, t] (key)}
					<option value={key}>{t.name}</option>
				{/each}
			</select>
			<select bind:value={accentKey} aria-label="Accent">
				<option value="default">Accent: default</option>
				{#each Object.keys(ACCENTS) as key (key)}
					<option value={key}>Accent: {key}</option>
				{/each}
			</select>
		</div>
	</header>

	<main class="pane">
		<div class="doc-editor">
			<Editor
				bind:this={editor}
				{source}
				theme={theme.type}
				presentationMode={mode}
				blockDragHandles={false}
				plugins={BUNDLED_PLUGINS}
			>
				{#snippet header()}
					<div class="hero">
						<span class="hero-title">themed host embed</span>
						<span class="hero-meta">notes/host-theme.md</span>
					</div>
					<div class="mode-toggle" role="group" aria-label="Editor mode">
						{#each MODES as { value, label } (value)}
							<button
								type="button"
								class:active={mode === value}
								aria-pressed={mode === value}
								onclick={() => (mode = value)}>{label}</button
							>
						{/each}
					</div>
				{/snippet}
			</Editor>
		</div>
	</main>
</div>

<style>
	.host-page {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		font-family: var(--font-ui);
	}

	.shell-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 14px;
		color: var(--color-ui-muted);
		font-size: 12px;
	}

	.pickers {
		display: flex;
		gap: 6px;
	}

	.pickers select {
		background: var(--color-surface);
		color: var(--color-text-secondary);
		border: 1px solid var(--color-border);
		border-radius: 4px;
		font-family: var(--font-ui);
		font-size: 12px;
		padding: 3px 6px;
	}

	.pane {
		flex: 1;
		min-height: 0;
		margin: 0 8px 8px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}

	/* The host draws the frame and the editor scrolls inside it with no chrome of its own;
	   the type scale is inherited from here, which only works with no opt-in class above. */
	.doc-editor {
		height: 100%;
		--editor-font-size: 14px;
	}

	.doc-editor :global(.editor) {
		border: none;
		border-radius: 0;
		scrollbar-width: none;
	}

	.doc-editor :global(.editor::-webkit-scrollbar) {
		display: none;
	}

	.doc-editor :global(.editor .thematic-break-block[role='separator'] > hr) {
		border-top-color: var(--color-border);
	}

	.doc-editor :global(.editor > .block-list) {
		max-width: var(--page-max-width, 1200px);
		margin: 0 auto;
		width: 100%;
		padding: 0 24px;
	}

	.hero {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 32px;
		row-gap: 9px;
		max-width: var(--page-max-width, 1200px);
		margin: 0 auto;
		padding: 34px 24px 6px;
		width: 100%;
	}

	.hero-title {
		font-family: var(--font-ui);
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--color-text-primary);
	}

	.hero-meta {
		font-size: 12px;
		color: var(--color-ui-muted);
	}

	.mode-toggle {
		display: flex;
		justify-content: flex-end;
		gap: 2px;
		box-sizing: border-box;
		width: 100%;
		max-width: var(--page-max-width, 1200px);
		margin: 0 auto;
		padding: 0 24px;
	}

	.mode-toggle button {
		padding: 3px 9px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--color-ui-muted);
		font-family: var(--font-ui);
		font-size: 12px;
		cursor: pointer;
	}

	.mode-toggle button:hover {
		color: var(--color-text-primary);
	}

	.mode-toggle button.active {
		background: var(--color-border);
		color: var(--color-text-primary);
	}
</style>

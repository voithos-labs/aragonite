<script lang="ts" module>
	/** One menu glyph by name: its stroked paths, or a letter for the three text marks. */
	import { MENU_GLYPHS as GLYPHS, type MenuIconName } from '../../menu-icons';

	/**
	 * The marks as letters, the way a formatting bar draws them: a bold B, a slanted I, an S with
	 * its own line through it. Lucide's stroked outlines of these read as clip art at 16px.
	 */
	const LETTERS = {
		bold: { text: 'B', weight: 800, italic: false, strike: false },
		italic: { text: 'I', weight: 500, italic: true, strike: false },
		strikethrough: { text: 'S', weight: 600, italic: false, strike: true }
	} as const;
</script>

<script lang="ts">
	let { name, size = 14 }: { name: MenuIconName; size?: number } = $props();
	const letter = $derived(name in LETTERS ? LETTERS[name as keyof typeof LETTERS] : null);
</script>

{#if letter}
	<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
		<text
			x="12"
			y="17.5"
			text-anchor="middle"
			font-family="Georgia, 'Times New Roman', serif"
			font-size="17"
			font-weight={letter.weight}
			font-style={letter.italic ? 'italic' : 'normal'}
			fill="currentColor">{letter.text}</text
		>
		{#if letter.strike}
			<path d="M5 12.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
		{/if}
	</svg>
{:else}
	<svg
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		stroke-width="1.75"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		{#each GLYPHS[name] as d (d)}
			<path {d} />
		{/each}
	</svg>
{/if}

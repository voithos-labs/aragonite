<script lang="ts" module>
	/**
	 * Lucide glyphs the editor's own chrome draws (menus, the selection bar, table affordances),
	 * inlined as path data so the library carries no icon dependency. Every shape is a path so
	 * the stroke styling below covers all of them.
	 */
	const GLYPHS = {
		plus: ['M5 12h14', 'M12 5v14'],
		type: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'],
		trash: [
			'M3 6h18',
			'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6',
			'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2',
			'M10 11v6',
			'M14 11v6'
		],
		'arrow-up': ['m5 12 7-7 7 7', 'M12 19V5'],
		'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
		'arrow-left': ['m12 19-7-7 7-7', 'M19 12H5'],
		'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
		scissors: [
			'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
			'M8.12 8.12 12 12',
			'M20 4 8.12 15.88',
			'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
			'M14.8 14.8 20 20'
		],
		copy: [
			'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
			'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
		],
		clipboard: [
			'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
			'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'
		],
		'align-left': ['M15 12H3', 'M17 18H3', 'M21 6H3'],
		'align-center': ['M17 12H7', 'M19 18H5', 'M21 6H3'],
		'align-right': ['M21 12H9', 'M21 18H7', 'M21 6H3'],
		bold: ['M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8'],
		italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
		strikethrough: ['M16 4H9a3 3 0 0 0-2.83 4', 'M14 12a4 4 0 0 1 0 8H6', 'M4 12h16'],
		code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
		link: [
			'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
			'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
		],
		heading: ['M6 12h12', 'M6 20V4', 'M18 20V4'],
		list: ['M3 12h.01', 'M3 18h.01', 'M3 6h.01', 'M8 12h13', 'M8 18h13', 'M8 6h13'],
		'list-ordered': ['M10 12h11', 'M10 18h11', 'M10 6h11', 'M4 10h2', 'M4 6h1v4', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
		'square-check': [
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
			'm9 12 2 2 4-4'
		],
		'text-quote': ['M17 6H3', 'M21 12H8', 'M21 18H8', 'M3 12v6'],
		minus: ['M5 12h14'],
		table: [
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
			'M12 3v18',
			'M3 9h18',
			'M3 15h18'
		],
		sigma: [
			'M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2'
		],
		info: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M12 16v-4', 'M12 8h.01'],
		'chevron-right': ['m9 18 6-6-6-6'],
		'chevron-down': ['m6 9 6 6 6-6'],
		'rows-2': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M3 12h18'],
		'columns-2': ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M12 3v18'],
		check: ['M20 6 9 17l-5-5']
	} as const;

	/**
	 * The marks as LETTERS, the way a formatting bar draws them: a bold B, a slanted I, an S with
	 * its own line through it. Lucide's stroked outlines of these read as clip art at 16px.
	 */
	const LETTERS = {
		bold: { text: 'B', weight: 800, italic: false, strike: false },
		italic: { text: 'I', weight: 500, italic: true, strike: false },
		strikethrough: { text: 'S', weight: 600, italic: false, strike: true }
	} as const;

	export type MenuIconName = keyof typeof GLYPHS;
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

<script lang="ts" module>
	/**
	 * Lucide glyphs the editor's own chrome draws (menus, the selection bar, table affordances),
	 * inlined as path data so the library carries no icon dependency. Every shape is a path so
	 * the stroke styling below covers all of them.
	 */
	const GLYPHS = {
		plus: ['M5 12h14', 'M12 5v14'],
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
		]
	} as const;

	export type MenuIconName = keyof typeof GLYPHS;
</script>

<script lang="ts">
	let { name, size = 14 }: { name: MenuIconName; size?: number } = $props();
</script>

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

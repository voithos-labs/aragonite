<script module lang="ts">
	import { calloutPlugin } from './callout/register';
	import { detailsPlugin } from '$lib/plugins/details';
	import { latexPlugin } from '$lib/plugins/latex';
	import { katexRenderer } from '$lib/plugins/latex/renderer';
	import { admonitionsPlugin } from '$lib/plugins/admonitions';
	import { mermaidPlugin } from '$lib/plugins/mermaid';
	import { mermaidRenderer } from '$lib/plugins/mermaid/renderer';
	import { memoPlugin } from './memo/register';
	import { docStatsPlugin } from './doc-stats/doc-stats-plugin';
	import { tocPlugin } from '$lib/plugins/toc';
	import { footnotesPlugin } from '$lib/plugins/footnotes';
	import { emojiPlugin } from '$lib/plugins/emoji';
	import { highlightOccurrencesPlugin } from '$lib/plugins/highlight-occurrences';
	import { hloccurScanProbePlugin } from './hloccur-scan/hloccur-scan-plugin';
	import { ghostTextPlugin } from './ghost-text/ghost-text-plugin';
	import { foldPlugin } from './fold/fold-plugin';
	import { blockBadgePlugin } from './block-badge/block-badge-plugin';
	import { simMarkPlugin } from './sim-mark/sim-mark-plugin';
	import { simIslandPlugin } from './sim-island/sim-island-plugin';
	import { wikiEmbedPlugin } from './wiki-embed/wiki-embed-plugin';
	import type { EditorPlugin } from '$lib/plugin';

	// Module scope so the factories run once per process, not once per (SSR) render:
	// re-minting fresh same-name plugin objects each render would trip installPlugins'
	// first-wins dev-warn. A stable array is also the pattern a consumer should copy.
	// The prop installs before the child <Editor> parses `source`, so `:::note` /
	// `<details>` / `$…$` / ```mermaid resolve to plugin kinds; callout/admonitions
	// setups turn on the generic `:::name` grammar the generic-directive e2e drives.
	// docStatsPlugin is a bare entry (no options), so the doc-stats e2e also covers
	// the options-default branch of the context spine. tocPlugin claims `[[toc]]` and
	// reads its heading list off the `document` component prop.
	const basePlugins = [
		calloutPlugin(),
		detailsPlugin(),
		latexPlugin({ renderer: katexRenderer }),
		admonitionsPlugin(),
		mermaidPlugin({ renderer: mermaidRenderer }),
		memoPlugin(),
		docStatsPlugin,
		tocPlugin()
	];

	// Decoration dogfoods annotate ambient content (the focused paragraph, every
	// occurrence of a word), so each installs only under its own seed — leaked
	// into sibling seeds their decorations would perturb those batteries.
	const seedPlugins: Record<string, EditorPlugin[]> = {
		// The footnote definition is a block kind; scoped to its own seed so the `[^…]:`
		// opener only claims lines under the footnotes battery, leaving sibling seeds' parses untouched.
		footnotes: [footnotesPlugin()],
		'footnotes-ref': [footnotesPlugin()],
		// Emoji rides the bare `:` trigger process-wide once installed; scoped to its own
		// seed so its rung never perturbs a sibling battery's `:`-bearing prose.
		emoji: [emojiPlugin()],
		// The `![[…]]` rung mints a built-in `image`, so it would claim `!` for every
		// sibling seed's prose once installed; scoped to its own.
		'wiki-embed': [wikiEmbedPlugin],
		hloccur: [highlightOccurrencesPlugin()],
		// The memoization battery installs the observability wrapper (same shipped
		// createOccurrenceSource) so it can read the index-rebuild count off window.
		'hloccur-memo': [hloccurScanProbePlugin],
		ghost: [ghostTextPlugin],
		fold: [foldPlugin],
		'fold-table': [foldPlugin],
		badge: [blockBadgePlugin],
		// The loaded-ops simulations navigate with `?seed=sim` to put standing
		// decoration sources under the corruption oracle; they loadContent their own
		// document over the (absent) seed document. The mark source watches the engine
		// on every edit; the island source is content-keyed on sentinels only the
		// decoration-ops document carries, so it is inert in the other sim sessions.
		sim: [simMarkPlugin, simIslandPlugin]
	};
</script>

<script lang="ts">
	import { Editor, type PresentationMode } from '$lib';
	import type { KeybindingOverride } from '$lib/schema/keybinding-overrides';
	import type { PageData } from './$types';
	import { installTestProbes } from '../editor/test-probes';
	import { trackParityDocument } from '../../parity-documents.svelte';
	import { convertGithubAlertsInDocument, hasGithubAlert } from '$lib/plugins/admonitions';

	let { data }: { data: PageData } = $props();

	const CALLOUT_SEED = ':::note Title\nFirst\n:::\n';
	const DETAILS_SEED = '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n';
	const MATH_SEED = 'Before $x^2$ after\n\nNext\n';
	// Two inline equations in ONE paragraph — the showcase shape that surfaced the
	// reveal collapse/switch class: a same-block click-away must fold the revealed
	// source, and clicking the second widget while the first is revealed must switch.
	const MATH_TWO_SEED = 'Sum $E=mc^2$ and $a^2+b^2=c^2$ tail\n\nNext\n';
	// Math on the first visual line; a soft-wrapped second line (pre-wrap renders the
	// internal newline as a break) column-aligns real text beneath the widget, for the
	// reveal hit-test's X-and-Y coverage.
	const MATH_MULTILINE_SEED = '$x^2$ first line padding\nsecond visual line here\n\nNext\n';
	// A block `$$…$$` leaf between two paragraphs, so the block-math e2e can drive
	// focus/click reveal, blur re-render, and arrow nav in and out of the block.
	const MATH_BLOCK_SEED = 'Before\n\n$$x^2$$\n\nAfter\n';
	// GitHub's third math form: a ```math fence between two paragraphs, so the
	// math-fence e2e can prove the distinct `mathFence` kind renders through the
	// shared BlockMath component and survives a reveal→edit→commit round trip.
	const MATH_FENCE_SEED = 'Before\n\n```math\nx^2\n```\n\nAfter\n';
	// Inline math inside a table cell, so the portal-widget e2e can prove the cell
	// render surface pools component widgets (mount id stable while typing in the cell).
	const MATH_TABLE_SEED = '| Formula | Note |\n| --- | --- |\n| $x^2$ | ok |\n\nAfter\n';
	// A multi-line `aligned` fence: the render must survive internal `\n`s (A7), and
	// the revealed source must stay a single text node so the offset walk is exact.
	const MATH_BLOCK_MULTILINE_SEED =
		'Before\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nAfter\n';
	// A plain-mode `%%` memo leaf between two paragraphs, so the editable-leaf e2e
	// can drive real typing, arrow traversal, undo batching, and selection sweeps.
	const MEMO_SEED = 'Before\n\n%% memo text\n\nAfter\n';
	// Two plain top-level paragraphs: a deterministic block count for the doc-stats
	// records, and a root-level Enter split + undo for the attach-survives-a-
	// structural-edit pin.
	const DOC_STATS_SEED = 'First\n\nSecond\n';
	// Two ATX headings and one setext heading above a top-level `[[toc]]`, with a
	// trailing paragraph as a blur target: the toc dogfood reads its heading list off
	// the `document` prop, so this seed exercises both heading kinds and a live edit.
	const TOC_SEED = '# Overview\n\n## Details\n\nAppendix\n========\n\n[[toc]]\n\nFooter\n';
	// A `[[toc]]` nested inside a blockquote below the headings: the prop reaches a
	// nested block only through editor context, so this pins the container render path.
	const TOC_NESTED_SEED = '# Chapter One\n\n## Section A\n\n> [[toc]]\n\nAfter\n';
	// 'cat' twice in block 0 and once in block 1; 'catalog' pins the whole-word scan.
	const HLOCCUR_SEED =
		'the cat sat on a mat and a cat ran\n\na cat sleeps\n\nthe catalog is here.\n';
	// The memoization + capability-skip seed: 'alpha' twice in the paragraph, once in a
	// table body cell (highlights), and once inside a fenced code block (skipped — a
	// non-prose leaf). Block [0] paragraph, [1] table, [2] fenced code.
	const HLOCCUR_MEMO_SEED =
		'alpha beta alpha\n\n| head | note |\n| --- | --- |\n| alpha | ok |\n\n```\nalpha in code\n```\n';
	// Two plain paragraphs: the ghost island follows focus between them, and an
	// Enter split provides the empty-paragraph caret-anchor case.
	const GHOST_SEED = 'Hello world\n\nSecond paragraph\n';
	// One `[>…<]` fold range mid-paragraph; the trailing paragraph is a blur target.
	const FOLD_SEED = 'abc [>HIDDEN SECRET<] def\n\nplain text\n';
	// A fold range inside a table cell — the islands-in-cells gap pin.
	const FOLD_TABLE_SEED = '| a [>SECRET<] b | c |\n| --- | --- |\n| d | e |\n';
	// Two headings among paragraphs for the badge predicate's positive and negative.
	const BADGE_SEED = '# Title\n\nfirst para\n\n## Sub\n\nsecond para\n';
	// A prose paragraph carrying a reference literal, then a footnote definition whose
	// body is one editable paragraph — the container's edit/backspace/undo surface, with
	// a blank starting line above for typing a fresh definition.
	const FOOTNOTES_SEED = 'A note reference [^a] in prose.\n\n[^a]: The note body.\n';
	// The reference-widget seed: the references sit in block 1 (not block 0), so typing
	// an EARLIER reference into block 0 renumbers block 1's widgets while block 1 itself
	// is never edited — the reactive-getter renumber the pool key cannot deliver.
	const FOOTNOTES_REF_SEED =
		'Intro line here.\n\nBody has [^a] and [^b] here.\n\n[^a]: First note.\n\n[^b]: Second note.\n';
	// A `:smile:` reference mid-prose (block 0) plus a plain typing target (block 1):
	// the emoji e2e drives seed render, live typing, caret step-over, atomic delete, and
	// a range copy that must yield the source bytes.
	const EMOJI_SEED = 'Mood :smile: today\n\nType here\n';
	// An `![[…]]` embed the rung mints as a built-in image, sized so one resize step
	// is visible in the bytes, with prose either side as blur and caret targets.
	const WIKI_EMBED_SEED = 'Before\n\n![[/test-fixtures/sample.png|400]]\n\nAfter\n';
	// Several directive admonition kinds (untitled important, titled tip/caution), one
	// native GitHub-alert blockquote (renders styled with its bytes untouched), and a
	// `> [!NOTE]` inside a fence that the convert affordance must leave literal — the
	// conversion route's positive and negative. `note` and `warning` are deliberately
	// absent: the co-registered callout dogfood claims those two directive names first,
	// so an admonition seed must use kinds callout does not own.
	const ADMONITIONS_SEED = [
		'# Admonitions',
		'',
		':::important',
		'Untitled — the kind name stands in for the missing title.',
		':::',
		'',
		':::tip Pro tip',
		'A titled tip.',
		':::',
		'',
		':::caution Heads up',
		'A titled caution.',
		':::',
		'',
		'Migrate the blockquote alert below with the Convert button:',
		'',
		'> [!CAUTION]',
		'> Still a blockquote alert.',
		'',
		'```markdown',
		'> [!NOTE]',
		'> Inside a fence — must not convert.',
		'```',
		''
	].join('\n');

	// Two rendering diagrams, one invalid-code diagram (no diagram type, so the
	// engine rejects deterministically), and a plain ```js fence that must stay
	// fencedCode, with a trailing paragraph for the editor-keeps-working check.
	const MERMAID_SEED = [
		'# Mermaid',
		'',
		'```mermaid',
		'graph TD',
		'\tA[Start] --> B[Finish]',
		'```',
		'',
		'```mermaid',
		'sequenceDiagram',
		'\tAlice->>Bob: Hello',
		'```',
		'',
		'```mermaid',
		'notadiagram',
		'broken',
		'```',
		'',
		'```js',
		'const x = 1;',
		'```',
		'',
		'After',
		''
	].join('\n');

	// The callout is the default document (the landed callout e2e reads it directly);
	// `?seed=<name>` swaps in another plugin's document. The seed arrives via the
	// load data, so the server and client render the same document. One-time
	// snapshot: the harness never re-navigates client-side, and the test probes
	// then own `source`.
	const SEEDS: Record<string, string> = {
		details: DETAILS_SEED,
		admonitions: ADMONITIONS_SEED,
		math: MATH_SEED,
		'math-two': MATH_TWO_SEED,
		'math-multiline': MATH_MULTILINE_SEED,
		mathblock: MATH_BLOCK_SEED,
		mathfence: MATH_FENCE_SEED,
		'mathblock-multiline': MATH_BLOCK_MULTILINE_SEED,
		mathtable: MATH_TABLE_SEED,
		mermaid: MERMAID_SEED,
		memo: MEMO_SEED,
		docstats: DOC_STATS_SEED,
		toc: TOC_SEED,
		'toc-nested': TOC_NESTED_SEED,
		hloccur: HLOCCUR_SEED,
		'hloccur-memo': HLOCCUR_MEMO_SEED,
		ghost: GHOST_SEED,
		fold: FOLD_SEED,
		'fold-table': FOLD_TABLE_SEED,
		badge: BADGE_SEED,
		footnotes: FOOTNOTES_SEED,
		'footnotes-ref': FOOTNOTES_REF_SEED,
		emoji: EMOJI_SEED,
		'wiki-embed': WIKI_EMBED_SEED
	};
	// svelte-ignore state_referenced_locally
	const plugins = [...basePlugins, ...(seedPlugins[data.seed ?? ''] ?? [])];
	// svelte-ignore state_referenced_locally
	let source = $state(SEEDS[data.seed ?? ''] ?? CALLOUT_SEED);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let presentationMode = $state<PresentationMode>('source');
	let editor = $state<ReturnType<typeof Editor>>();

	trackParityDocument(() => editor);

	$effect(() => {
		if (!editor) return;
		installTestProbes({
			editor,
			setSource: (md) => {
				source = md;
			},
			setKeybindings: (overrides) => {
				keybindings = overrides;
			},
			setPresentationMode: (mode) => {
				presentationMode = mode;
			}
		});
	});

	// The docs' sanctioned document-rewrite pattern: read getSource(), rewrite the
	// GitHub-alert blockquotes to `:::name` source, and write it back through the
	// `source` prop. One document swap — undo history and caret do not survive.
	function convertAlerts() {
		if (!editor) return;
		const { converted, changed } = convertGithubAlertsInDocument(editor.getSource());
		if (changed) source = converted;
	}

	// Enablement follows both channels: `source` for programmatic swaps, the `edit`
	// event for user typing. A marker inside a code fence must not light the button,
	// so the cheap text probe gates the parse-scoped confirmation.
	function canConvertSource(s: string): boolean {
		return hasGithubAlert(s) && convertGithubAlertsInDocument(s).changed;
	}
	// Deliberately NOT a $derived: canConvertSource parses, and a render-time
	// parse races the page's async plugin installs — the first parse must land
	// after registration or every opener fires late-opener-registration. The
	// effect's post-mount timing is the sequencing, not an accident.
	// eslint-disable-next-line svelte/prefer-writable-derived -- deferral is load-bearing (see above)
	let canConvert = $state(false);
	$effect(() => {
		canConvert = canConvertSource(source);
	});
	$effect(() => {
		if (!editor) return;
		return editor.getEvents().on('edit', () => {
			canConvert = canConvertSource(editor!.getSource());
		});
	});
</script>

<div class="plugins-harness aragonite-editor-theme">
	{#if data.seed === 'admonitions'}
		<div class="harness-controls">
			<button onclick={convertAlerts} disabled={!canConvert} data-testid="convert-alerts">
				Convert GitHub alerts
			</button>
		</div>
	{/if}
	{#if data.seed === 'mathblock'}
		<div class="harness-controls">
			<!-- onmousedown preventDefault keeps editor focus: a flip while a render-primary
			     reveal is open must commit through the blur-class mode effect (mode already
			     reading), not a focus-stealing blur that commits in source mode. -->
			<button
				data-testid="presentation-toggle"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => (presentationMode = presentationMode === 'reading' ? 'source' : 'reading')}
			>
				{presentationMode === 'reading' ? 'Source mode' : 'Reading mode'}
			</button>
		</div>
	{/if}
	<Editor bind:this={editor} {source} {keybindings} {plugins} {presentationMode} />
</div>

<style>
	.plugins-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.harness-controls {
		display: flex;
		gap: 0.5rem;
		padding: 0.4rem;
	}

	.plugins-harness :global(.decoration-overlay.hl-occurrence) {
		background: rgba(250, 204, 21, 0.35);
	}

	.plugins-harness :global(.decoration-overlay.sim-standing-mark) {
		background: rgba(96, 165, 250, 0.3);
	}

	/* Generated content only — the islands stay byte-empty so the raw-offset walk
	   reads the block back exactly (::after and background paint nothing into
	   textContent). */
	.plugins-harness :global(.decoration-island.sim-replace-island)::after {
		content: '…';
		color: #9ca3af;
	}

	.plugins-harness :global(.decoration-island .sim-widget-island-content) {
		display: inline-block;
		width: 2px;
		background: rgba(52, 211, 153, 0.6);
	}

	.plugins-harness :global(.decoration-badge .sim-badge) {
		display: inline-block;
		margin-right: 0.3rem;
		padding: 0 0.25rem;
		border-radius: 3px;
		background: rgba(251, 191, 36, 0.35);
		font-size: 0.7em;
	}
</style>

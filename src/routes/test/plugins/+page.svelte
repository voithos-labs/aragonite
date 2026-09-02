<script module lang="ts">
	import { calloutPlugin } from './callout/register';
	import {
		DEMO_ADMONITIONS,
		DEMO_DETAILS,
		DEMO_EMOJI,
		DEMO_FOOTNOTES,
		DEMO_HIGHLIGHT_OCCURRENCES,
		DEMO_LATEX,
		DEMO_MERMAID,
		DEMO_PARROT,
		DEMO_TOC
	} from '../../demo-plugins';
	import { memoPlugin } from './memo/register';
	import { docStatsPlugin } from './doc-stats/doc-stats-plugin';
	import { hloccurScanProbePlugin } from './hloccur-scan/hloccur-scan-plugin';
	import { ghostTextPlugin } from './ghost-text/ghost-text-plugin';
	import { foldPlugin } from './fold/fold-plugin';
	import { blockBadgePlugin } from './block-badge/block-badge-plugin';
	import { simMarkPlugin } from './sim-mark/sim-mark-plugin';
	import { simIslandPlugin } from './sim-island/sim-island-plugin';
	import { wikiEmbedPlugin } from './wiki-embed/wiki-embed-plugin';
	import type { EditorPlugin } from '$lib/plugin';

	// docStatsPlugin is a bare entry (no options), covering the options-default branch.
	const basePlugins = [
		calloutPlugin(),
		DEMO_DETAILS,
		DEMO_LATEX,
		DEMO_ADMONITIONS,
		DEMO_MERMAID,
		memoPlugin(),
		docStatsPlugin,
		DEMO_TOC
	];

	// Decoration dogfoods annotate ambient content, so each installs only under its own
	// seed: leaked into siblings, their decorations would perturb those batteries.
	const seedPlugins: Record<string, EditorPlugin[]> = {
		// Scoped to its own seed so the `[^…]:` opener only claims lines under the
		// footnotes battery, leaving sibling seeds' parses untouched.
		footnotes: [DEMO_FOOTNOTES],
		'footnotes-ref': [DEMO_FOOTNOTES],
		// Emoji rides the bare `:` trigger process-wide once installed; scoped to its own
		// seed so its rung never perturbs a sibling battery's `:`-bearing prose.
		emoji: [DEMO_EMOJI],
		// The `![[…]]` rung mints a built-in `image`, so it would claim `!` for every
		// sibling seed's prose once installed; scoped to its own.
		'wiki-embed': [wikiEmbedPlugin],
		// `%%parrot` is a narrowing of the base memo fixture's `%%`, and the bird animates on
		// an interval; scoped to its own seed so neither reaches a sibling battery.
		parrot: [DEMO_PARROT],
		hloccur: [DEMO_HIGHLIGHT_OCCURRENCES],
		// The observability wrapper over the same shipped createOccurrenceSource, so the
		// battery can read the index-rebuild count off window.
		'hloccur-memo': [hloccurScanProbePlugin],
		ghost: [ghostTextPlugin],
		fold: [foldPlugin],
		'fold-table': [foldPlugin],
		badge: [blockBadgePlugin],
		// `?seed=sim` puts standing decoration sources under the corruption oracle; the sims
		// loadContent their own document over the absent seed, and the island source is keyed
		// on sentinels only that document carries.
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

	// The fenced `> [!NOTE]` is the convert affordance's negative — it must stay literal.
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

	// One invalid-code diagram (no diagram type, so the engine rejects deterministically)
	// and a plain ```js fence that must stay fencedCode.
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

	// `?seed=<name>` swaps in another plugin's document; callout is the default. The seed
	// arrives via load data so server and client render the same document, once: the harness
	// never re-navigates, and the probes then own `source`.
	const SEEDS: Record<string, string> = {
		callout: ':::callout Title\nFirst\n:::\n',
		details: '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
		admonitions: ADMONITIONS_SEED,
		math: 'Before $x^2$ after\n\nNext\n',
		// Two inline equations in ONE paragraph: a same-block click-away must fold the revealed
		// source, and clicking the second widget while the first is revealed must switch.
		'math-two': 'Sum $E=mc^2$ and $a^2+b^2=c^2$ tail\n\nNext\n',
		// A second visual line column-aligns real text beneath the widget, giving the reveal
		// hit-test both X and Y coverage.
		'math-multiline': '$x^2$ first line padding\nsecond visual line here\n\nNext\n',
		// Paragraphs either side, so the block-math e2e can drive arrow nav in and out.
		mathblock: 'Before\n\n$$x^2$$\n\nAfter\n',
		// GitHub's third math form: a distinct `mathFence` kind that still renders through the
		// shared BlockMath component.
		mathfence: 'Before\n\n```math\nx^2\n```\n\nAfter\n',
		// A multi-line `aligned` fence: the render must survive internal `\n`s (A7), and
		// the revealed source must stay a single text node so the offset walk is exact.
		'mathblock-multiline':
			'Before\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nAfter\n',
		// Inline math inside a table cell: the cell render surface pools component widgets,
		// so the mount id stays stable while typing.
		mathtable: '| Formula | Note |\n| --- | --- |\n| $x^2$ | ok |\n\nAfter\n',
		mermaid: MERMAID_SEED,
		// A plain-mode `%%` memo leaf between two paragraphs — the editable-leaf surface.
		memo: 'Before\n\n%% memo text\n\nAfter\n',
		// A deterministic block count, plus a root-level Enter split + undo for the
		// attach-survives-a-structural-edit pin.
		docstats: 'First\n\nSecond\n',
		// Both heading syntaxes above a top-level `[[toc]]`, with a trailing paragraph as a
		// blur target; the toc dogfood reads its heading list off the `document` prop.
		toc: '# Overview\n\n## Details\n\nAppendix\n========\n\n[[toc]]\n\nFooter\n',
		// A `[[toc]]` nested inside a blockquote below the headings: the prop reaches a
		// nested block only through editor context, so this pins the container render path.
		'toc-nested': '# Chapter One\n\n## Section A\n\n> [[toc]]\n\nAfter\n',
		// 'cat' twice in block 0 and once in block 1; 'catalog' pins the whole-word scan.
		hloccur: 'the cat sat on a mat and a cat ran\n\na cat sleeps\n\nthe catalog is here.\n',
		// 'alpha' twice in the paragraph, once in a table body cell (highlights), once inside
		// a fenced code block (skipped, a non-prose leaf).
		'hloccur-memo':
			'alpha beta alpha\n\n| head | note |\n| --- | --- |\n| alpha | ok |\n\n```\nalpha in code\n```\n',
		// Two plain paragraphs: the ghost island follows focus between them, and an
		// Enter split provides the empty-paragraph caret-anchor case.
		ghost: 'Hello world\n\nSecond paragraph\n',
		// One `[>…<]` fold range mid-paragraph; the trailing paragraph is a blur target.
		fold: 'abc [>HIDDEN SECRET<] def\n\nplain text\n',
		// A fold range inside a table cell — the islands-in-cells gap pin.
		'fold-table': '| a [>SECRET<] b | c |\n| --- | --- |\n| d | e |\n',
		// Two headings among paragraphs for the badge predicate's positive and negative.
		badge: '# Title\n\nfirst para\n\n## Sub\n\nsecond para\n',
		// A footnote definition whose body is one editable paragraph — the container's
		// edit/backspace/undo surface.
		footnotes: 'A note reference [^a] in prose.\n\n[^a]: The note body.\n',
		// The references sit in block 1, so typing an EARLIER reference into block 0 renumbers
		// block 1's widgets while block 1 is never edited — the renumber a pool key can't deliver.
		'footnotes-ref':
			'Intro line here.\n\nBody has [^a] and [^b] here.\n\n[^a]: First note.\n\n[^b]: Second note.\n',
		// A `:smile:` mid-prose (block 0) plus a plain typing target (block 1).
		emoji: 'Mood :smile: today\n\nType here\n',
		// The rung mints a built-in image; the explicit size makes one resize step visible in
		// the bytes, with prose either side as blur and caret targets.
		'wiki-embed': 'Before\n\n![[/test-fixtures/sample.png|400]]\n\nAfter\n',
		// The caption is the bytes after the marker, so block 0 is the caption target and
		// block 1 a plain blur target.
		parrot: '%%parrot party responsibly\n\nAfter\n'
	};
	// svelte-ignore state_referenced_locally
	const plugins = [...basePlugins, ...(seedPlugins[data.seed ?? ''] ?? [])];
	// svelte-ignore state_referenced_locally
	let source = $state(SEEDS[data.seed ?? ''] ?? SEEDS.callout);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let presentationMode = $state<PresentationMode>('source');
	// Seeds whose batteries drive a real mode flip / theme flip through the header
	// controls. Gated per seed so a sibling battery's DOM carries no extra chrome.
	const MODE_TOGGLE_SEEDS = ['mathblock', 'details'];
	const THEME_TOGGLE_SEEDS = ['mermaid'];
	let theme = $state<'dark' | 'light'>('dark');
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

	// The docs' sanctioned document-rewrite pattern: rewrite and write back through the
	// `source` prop. One document swap, so undo history and caret do not survive.
	function convertAlerts() {
		if (!editor) return;
		const { converted, changed } = convertGithubAlertsInDocument(editor.getSource());
		if (changed) source = converted;
	}

	// A marker inside a code fence must not light the button, so the cheap text probe
	// gates the parse-scoped confirmation.
	function canConvertSource(s: string): boolean {
		return hasGithubAlert(s) && convertGithubAlertsInDocument(s).changed;
	}
	// Deliberately NOT a $derived: canConvertSource parses, and a render-time parse races
	// the page's async plugin installs — the first parse must land after registration or
	// every opener fires late-opener-registration.
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
	{#if MODE_TOGGLE_SEEDS.includes(data.seed ?? '')}
		<div class="harness-controls">
			<!-- preventDefault keeps editor focus: a flip while a render-primary reveal is open
			     must commit through the blur-class mode effect, not a focus-stealing blur. -->
			<button
				data-testid="presentation-toggle"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => (presentationMode = presentationMode === 'reading' ? 'source' : 'reading')}
			>
				{presentationMode === 'reading' ? 'Source mode' : 'Reading mode'}
			</button>
		</div>
	{/if}
	{#if THEME_TOGGLE_SEEDS.includes(data.seed ?? '')}
		<div class="harness-controls">
			<button
				data-testid="theme-toggle"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => (theme = theme === 'dark' ? 'light' : 'dark')}
			>
				{theme === 'dark' ? 'Light theme' : 'Dark theme'}
			</button>
		</div>
	{/if}
	<Editor
		bind:this={editor}
		{source}
		{keybindings}
		{plugins}
		{presentationMode}
		{theme}
		blockDragHandles
	/>
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

	/* Generated content only: the islands stay byte-empty so the raw-offset walk reads
	   the block back exactly. */
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

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
	import { tagsPlugin } from './tags/tag-plugin';
	import { tagMarksPlugin, TAG_MENU } from '../../demo-tags/tag-marks-plugin';
	import { docLinkMenuPlugin, DOC_LINK_MENU } from './inline-menu/doc-link-menu-plugin';
	import '../../demo-tags/tag-marks.css';
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

	// The decoration examples annotate whatever text is there, so each installs only under its
	// own seed: leaking into the others, their decorations would disturb those suites.
	const seedPlugins: Record<string, EditorPlugin[]> = {
		// Kept to its own seed so the `[^…]:` opener takes lines only in the footnotes
		// suite, leaving the other seeds to parse as they did.
		footnotes: [DEMO_FOOTNOTES],
		'footnotes-ref': [DEMO_FOOTNOTES],
		// Emoji takes the bare `:` trigger process-wide once installed, so it is kept to its own
		// seed and never disturbs prose containing a `:` in another suite.
		emoji: [DEMO_EMOJI],
		// The `![[…]]` handler creates a built-in `image`, so once installed it would take `!`
		// in every other seed's prose; kept to its own.
		'wiki-embed': [wikiEmbedPlugin],
		// The bare `#` trigger would take `#` in every other seed's prose once installed,
		// so it is kept to its own seed.
		tags: [tagsPlugin()],
		// The same tags as mark decorations over plain text: no widget, no source to show.
		'tags-marks': [tagMarksPlugin()],
		// Both inline-menu sources at once: `#` and `[[` must not take each other's presses.
		'inline-menu': [tagMarksPlugin(), docLinkMenuPlugin()],
		// `%%parrot` is a narrower form of the base memo fixture's `%%`, and the bird animates on
		// an interval; kept to its own seed so neither reaches another suite.
		parrot: [DEMO_PARROT],
		hloccur: [DEMO_HIGHLIGHT_OCCURRENCES],
		// A counting wrapper around the same shipped createOccurrenceSource, so the suite can
		// read off `window` how often the index rebuilds.
		'hloccur-memo': [hloccurScanProbePlugin],
		ghost: [ghostTextPlugin],
		fold: [foldPlugin],
		'fold-table': [foldPlugin],
		badge: [blockBadgePlugin],
		// `?seed=sim` puts long-lived decoration sources under the simulation's corruption
		// checks; the simulations load their own document over the empty seed, and the widget
		// source keys on sentinels only that document holds.
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

	// The `> [!NOTE]` inside a fence is what the Convert button must leave alone: it stays literal.
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

	// One diagram with invalid code (no diagram type, so mermaid rejects it every time)
	// and a plain ```js fence that must stay a code block.
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

	// `?seed=<name>` swaps in another plugin's document; callout is the default. The seed comes
	// from the load function, so server and client render the same document once: the harness
	// never navigates again, and the probes own `source` from then on.
	const SEEDS: Record<string, string> = {
		callout: ':::callout Title\nFirst\n:::\n',
		details: '<details open>\n<summary>Summary</summary>\n\nBody\n\n</details>\n',
		admonitions: ADMONITIONS_SEED,
		math: 'Before $x^2$ after\n\nNext\n',
		// Two inline equations in one paragraph: clicking elsewhere in the same block must
		// collapse the shown source, and clicking the second widget while the first is open
		// must switch.
		'math-two': 'Sum $E=mc^2$ and $a^2+b^2=c^2$ tail\n\nNext\n',
		// A second visual line puts real text directly below the widget, so the hit test that
		// shows the source is exercised on both axes.
		'math-multiline': '$x^2$ first line padding\nsecond visual line here\n\nNext\n',
		// Paragraphs either side, so the block-math e2e can drive arrow nav in and out.
		mathblock: 'Before\n\n$$x^2$$\n\nAfter\n',
		// GitHub's third math form: a distinct `mathFence` kind that still renders through the
		// shared BlockMath component.
		mathfence: 'Before\n\n```math\nx^2\n```\n\nAfter\n',
		// A multi-line `aligned` fence: the render must survive the `\n`s inside it (A7), and
		// the shown source must stay one text node so the offset walk is exact.
		'mathblock-multiline':
			'Before\n\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\nAfter\n',
		// Inline math inside a table cell: the cell's render reuses component widgets, so the
		// mount id stays the same while typing.
		mathtable: '| Formula | Note |\n| --- | --- |\n| $x^2$ | ok |\n\nAfter\n',
		mermaid: MERMAID_SEED,
		// A plain `%%` memo block between two paragraphs: the editable-leaf case.
		memo: 'Before\n\n%% memo text\n\nAfter\n',
		// A known block count, plus an Enter split at the root and an undo, for the check that
		// the plugin stays attached across a structural edit.
		docstats: 'First\n\nSecond\n',
		// Both heading syntaxes above a top-level `[[toc]]`, with a trailing paragraph to click
		// away to; the toc example reads its heading list off the `document` prop.
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
		// Two plain paragraphs: the ghost widget follows focus between them, and an Enter split
		// gives the empty-paragraph case for the caret anchor.
		ghost: 'Hello world\n\nSecond paragraph\n',
		// One `[>…<]` fold range mid-paragraph; the trailing paragraph is there to click away to.
		fold: 'abc [>HIDDEN SECRET<] def\n\nplain text\n',
		// A fold range inside a table cell: the case for a widget inside a cell.
		'fold-table': '| a [>SECRET<] b | c |\n| --- | --- |\n| d | e |\n',
		// Two headings among paragraphs for the badge predicate's positive and negative.
		badge: '# Title\n\nfirst para\n\n## Sub\n\nsecond para\n',
		// A footnote definition whose body is one editable paragraph: the container's editing,
		// Backspace and undo case.
		footnotes: 'A note reference [^a] in prose.\n\n[^a]: The note body.\n',
		// The references sit in block 1, so typing an earlier reference into block 0 renumbers
		// block 1's widgets although block 1 is never edited: a renumber that reusing a widget
		// by key cannot produce.
		'footnotes-ref':
			'Intro line here.\n\nBody has [^a] and [^b] here.\n\n[^a]: First note.\n\n[^b]: Second note.\n',
		// A `:smile:` mid-prose (block 0) plus a plain typing target (block 1).
		emoji: 'Mood :smile: today\n\nType here\n',
		// The handler creates a built-in image; the explicit size makes one resize step visible
		// in the bytes, with prose either side to click away to and to put the caret in.
		'wiki-embed': 'Before\n\n![[/test-fixtures/sample.png|400]]\n\nAfter\n',
		// The caption is the bytes after the marker, so block 0 is the caption to edit and
		// block 1 is there to click away to.
		parrot: '%%parrot party responsibly\n\nAfter\n',
		// A tag mid-prose, one opening a line (the case a bare `#` heading opener contests),
		// one inside a heading's own content, and a plain typing target.
		tags: 'Filed under #project and #work/admin today\n\n#inbox leads this line\n\n# Heading with #tag inside\n\nType here\n',
		'tags-marks':
			'Filed under #project and #work/admin today\n\n#inbox leads this line\n\n# Heading with #tag inside\n\nType here\n',
		// Three tags to suggest (`project` twice, so it ranks first), a typing target, a list item,
		// and an inline code span where a `#` is not syntax.
		'inline-menu':
			'Filed under #project and #work/admin and #project\n\n#inbox leads\n\nType here\n\n- item\n\nIn `code` span\n'
	};
	// svelte-ignore state_referenced_locally
	const plugins = [...basePlugins, ...(seedPlugins[data.seed ?? ''] ?? [])];
	// svelte-ignore state_referenced_locally
	let source = $state(SEEDS[data.seed ?? ''] ?? SEEDS.callout);
	let keybindings = $state<KeybindingOverride[] | undefined>(undefined);
	let presentationMode = $state<PresentationMode>('source');
	// The seeds whose suites switch mode or theme for real through the header controls. Kept
	// per seed, so no other suite's DOM gains extra buttons.
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

	// The document-rewrite pattern the guides recommend: rewrite the Markdown and write it back
	// through the `source` prop. One whole-document swap, so undo history and caret do not survive.
	function convertAlerts() {
		if (!editor) return;
		const { converted, changed } = convertGithubAlertsInDocument(editor.getSource());
		if (changed) source = converted;
	}

	// A marker inside a code fence must not light the button, so the cheap text check runs
	// first and a parse confirms it.
	function canConvertSource(s: string): boolean {
		return hasGithubAlert(s) && convertGithubAlertsInDocument(s).changed;
	}
	// Deliberately not a $derived: canConvertSource parses, and a parse during render races the
	// page's asynchronous plugin installs. The first parse has to come after registration, or
	// every opener reports a late registration.
	// eslint-disable-next-line svelte/prefer-writable-derived -- the delay is required (see above)
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
	{#if data.seed === 'inline-menu'}
		<div class="harness-controls">
			<!-- preventDefault keeps the document's caret: `open` writes the trigger where it stands. -->
			<button
				data-testid="open-tag-menu"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => editor?.getInlineMenus().open(TAG_MENU)}
			>
				Insert tag
			</button>
			<button
				data-testid="open-doc-link-menu"
				onmousedown={(e) => e.preventDefault()}
				onclick={() => editor?.getInlineMenus().open(DOC_LINK_MENU)}
			>
				Link document
			</button>
		</div>
	{/if}
	{#if MODE_TOGGLE_SEEDS.includes(data.seed ?? '')}
		<div class="harness-controls">
			<!-- preventDefault keeps focus in the editor: a mode switch while a block is showing
			     its source must commit through the mode effect, not through a blur. -->
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

	/* Generated content only: the widgets add no text, so the raw-offset walk reads the
	   block back exactly. */
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

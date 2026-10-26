// The showcase in React: the shell around `examples/showcase/`, which holds the document, the
// plugins, the controls and the top bar the Svelte and Vue showcases share.
import { useEffect, useRef, useState } from 'react';
import { Aragonite } from '@voithos-labs/aragonite-react';
import type { EditorHandle } from '@voithos-labs/aragonite';
import SHOWCASE_DOCUMENT from '../../../showcase/showcase-content.md?raw';
import { INITIAL_STATE, showsSelectionMenu } from '../../../showcase/controls';
import {
	mountShowcaseBar,
	type ShowcaseBar,
	type ShowcaseBarState,
	type ToggleKey
} from '../../../showcase/top-bar';
import { showcasePlugins } from '../../../showcase/plugins';
import { readTheme, toggleTheme } from '../../../showcase/theme';
import { demoPasteImage, resolveDemoImageUrl } from '../../../showcase/image-store';

const CHANGELOG_URL = 'https://github.com/voithos-labs/aragonite/blob/main/docs/changelog.md';

export function Showcase() {
	const [source, setSource] = useState(SHOWCASE_DOCUMENT);
	const [theme, setTheme] = useState(readTheme);
	const [presentationMode, setPresentationMode] = useState(INITIAL_STATE.presentationMode);
	const [dragHandles, setDragHandles] = useState(INITIAL_STATE.dragHandles);
	const [selectionMenu, setSelectionMenu] = useState(INITIAL_STATE.selectionMenu);
	const [occurrences, setOccurrences] = useState(INITIAL_STATE.occurrences);
	const [showSource, setShowSource] = useState(INITIAL_STATE.showSource);
	const editor = useRef<EditorHandle>(null);
	const header = useRef<HTMLElement>(null);
	const bar = useRef<ShowcaseBar | null>(null);

	const barState: ShowcaseBarState = {
		mode: presentationMode,
		pressed: {
			theme: theme === 'dark',
			dragHandles,
			selectionMenu,
			occurrences,
			source: showSource
		}
	};

	useEffect(() => {
		const flips: Partial<Record<ToggleKey, () => void>> = {
			theme: () => setTheme(toggleTheme),
			dragHandles: () => setDragHandles((on) => !on),
			selectionMenu: () => setSelectionMenu((on) => !on),
			occurrences: () => setOccurrences((on) => !on),
			source: () => setShowSource((on) => !on)
		};
		bar.current = mountShowcaseBar(
			header.current!,
			{
				framework: 'React',
				changelogHref: CHANGELOG_URL,
				tools: ['source'],
				onMode: setPresentationMode,
				onToggle: (key) => flips[key]?.(),
				editor: () => editor.current
			},
			barState
		);
		return () => bar.current?.destroy();
		// Mounted once; the effect below hands the bar every later state.
	}, []);

	useEffect(() => bar.current?.update(barState));

	return (
		<div className="showcase aragonite-editor-theme" data-editor-theme={theme}>
			<header className="showcase-header" ref={header} />
			<div className="showcase-body">
				{/* The plugin set is read at mount, so the occurrences toggle remounts the editor; the
				    controlled value carries the document across. */}
				<Aragonite
					key={String(occurrences)}
					ref={editor}
					className="showcase-editor"
					value={source}
					onChange={setSource}
					plugins={showcasePlugins(occurrences)}
					blockDragHandles={dragHandles}
					onPasteImage={demoPasteImage}
					resolveImageUrl={resolveDemoImageUrl}
					presentationMode={presentationMode}
					linkClick="plain"
					selectionToolbar={showsSelectionMenu(presentationMode, selectionMenu)}
					theme={theme}
				/>
				{showSource && (
					<pre className="showcase-source" data-testid="source-view">
						{source}
					</pre>
				)}
			</div>
		</div>
	);
}

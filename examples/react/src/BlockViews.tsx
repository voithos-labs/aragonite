// The adapter suite's `?block-views` page (`examples/adapter-suite/requirements/block-views.md`):
// three blocks drawn by React components through `reactBlockView`, and an inline widget and a
// decoration badge through `reactView`.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
	Aragonite,
	BlockChildren,
	LeafContent,
	reactBlockView,
	reactView,
	type BlockViewProps
} from '@voithos-labs/aragonite-react';
import type { Decoration, InlineWidgetComponentProps } from '@voithos-labs/aragonite/plugin';
import {
	BLOCK_VIEWS_SOURCE,
	LONG_SOURCE,
	MEMO_LENGTH_ATTR,
	blockViewsPlugin
} from '../../adapter-suite/block-view-kinds';
import { viewMounted } from '../../adapter-suite/live-views';

const ANOTHER = '%% another memo\n\nplain text\n';

// Reaches the memo through `wrap`, as an app's theme or store provider would.
const BadgeText = createContext('no provider');

function Memo(_: BlockViewProps<'leaf'>) {
	return (
		<>
			<span className="memo-badge">{useContext(BadgeText)}</span>
			<LeafContent className="memo-text" />
		</>
	);
}

// While open, a preview follows the source as it's typed, block math's side-by-side shape.
function Label({ state, draft }: BlockViewProps<'render-primary'>) {
	const caption = (draft ?? state.node.raw).slice('@@ '.length).trim();
	if (!state.revealed) return <span className="label-text">{caption}</span>;
	return (
		<>
			<LeafContent className="label-source" />
			<span className="label-preview">{caption}</span>
		</>
	);
}

// `data-length` changes per edit in the box, so `BlockChildren` re-renders while it's typed in.
function Box({ state }: BlockViewProps<'container'>) {
	return (
		<>
			<span className="box-badge">box by react</span>
			<BlockChildren className="box-children" data-length={state.node.raw.length} />
		</>
	);
}

// Reaches the chip and the badge through `wrap`, each in a React root of its own.
const FrameworkName = createContext('no provider');
const withName = (view: ReactNode) => (
	<FrameworkName.Provider value="react">{view}</FrameworkName.Provider>
);

function Chip({ source, inline }: InlineWidgetComponentProps) {
	useEffect(viewMounted, []);
	return (
		<span className="chip" data-start={inline.start}>
			{source.slice(2, -2)} by {useContext(FrameworkName)}
		</span>
	);
}

function MemoLength({ decoration }: { decoration: Decoration }) {
	useEffect(viewMounted, []);
	const length = decoration.type === 'block' ? decoration.attrs?.[MEMO_LENGTH_ATTR] : '?';
	return (
		<span className="memo-length">
			{length} by {useContext(FrameworkName)}
		</span>
	);
}

const plugins = [
	blockViewsPlugin({
		memo: reactBlockView(Memo, {
			surface: 'leaf',
			singleLine: true,
			className: 'memo',
			wrap: (block) => <BadgeText.Provider value="memo by react">{block}</BadgeText.Provider>
		}),
		label: reactBlockView(Label, {
			surface: 'render-primary',
			singleLine: true,
			className: 'label'
		}),
		box: reactBlockView(Box, { surface: 'container', className: 'box' }),
		chip: reactView(Chip, { wrap: withName }),
		memoLength: reactView(MemoLength, { wrap: withName })
	})
];

export function BlockViews() {
	const [value, setValue] = useState(BLOCK_VIEWS_SOURCE);
	const [shown, setShown] = useState(true);

	return (
		<main>
			<button data-testid="load" onClick={() => setValue(ANOTHER)}>
				Load another doc
			</button>
			<button data-testid="load-long" onClick={() => setValue(LONG_SOURCE)}>
				Load a long doc
			</button>
			<button data-testid="unmount" onClick={() => setShown(!shown)}>
				{shown ? 'Unmount' : 'Mount'}
			</button>
			{shown && (
				<Aragonite
					value={value}
					onChange={setValue}
					plugins={plugins}
					theme="light"
					className="block-views-editor"
				/>
			)}
			<pre data-testid="mirror">{value}</pre>
		</main>
	);
}

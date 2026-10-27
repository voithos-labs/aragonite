// The adapter suite's `?block-views` page (`examples/adapter-suite/requirements/block-views.md`):
// four blocks drawn by React components through `reactBlockView`, and an inline widget and a
// decoration badge through `reactView`.
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode
} from 'react';
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
	blockViewsPlugin,
	noteText,
	type NoteHooks
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

// The note's text, focused whole, until a double click or Mod+M swaps in a textarea of its own;
// leaving the textarea commits it, Escape drops the edit.
function Note({ state, ctx }: BlockViewProps<'container'>) {
	const text = noteText(state.node);
	const [editing, setEditing] = useState(false);
	const box = useRef<HTMLTextAreaElement | null>(null);
	const shown = useRef<HTMLPreElement | null>(null);
	const refocus = useRef(false);
	const hooks: NoteHooks = { openEdit: () => setEditing(true) };
	ctx.container.setCommandHooks(hooks);

	const attachBox = useCallback(
		(el: HTMLTextAreaElement | null) => {
			box.current = el;
			ctx.container.attachFocus(el);
		},
		[ctx]
	);
	const attachShown = useCallback(
		(el: HTMLPreElement | null) => {
			shown.current = el;
			if (el) ctx.container.attachFocus(el);
		},
		[ctx]
	);
	useEffect(() => {
		if (editing) box.current?.focus();
		else if (refocus.current) shown.current?.focus();
		refocus.current = false;
	}, [editing]);

	function commit() {
		const next = box.current!.value + '\n';
		setEditing(false);
		if (next !== text) void ctx.container.updateOwnMetadata({ text: next });
	}
	function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === 'Escape') {
			e.preventDefault();
			refocus.current = true;
			box.current!.value = text.replace(/\n$/, '');
			setEditing(false);
		} else if (atEdge(e.currentTarget, e.key) && ctx.container.moveFocusOut(e.nativeEvent)) {
			e.preventDefault();
		}
	}

	if (editing) {
		return (
			<textarea
				ref={attachBox}
				className="note-source"
				defaultValue={text.replace(/\n$/, '')}
				onBlur={commit}
				onKeyDown={onKeyDown}
			/>
		);
	}
	return (
		<pre ref={attachShown} className="note-text" tabIndex={-1} onDoubleClick={hooks.openEdit}>
			{text}
		</pre>
	);
}

// The caret on the textarea's first line for ArrowUp, its last for ArrowDown.
function atEdge(box: HTMLTextAreaElement, key: string): boolean {
	if (box.selectionStart !== box.selectionEnd) return false;
	if (key === 'ArrowUp') return !box.value.slice(0, box.selectionStart).includes('\n');
	if (key === 'ArrowDown') return !box.value.slice(box.selectionStart).includes('\n');
	return false;
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
		note: reactBlockView(Note, { surface: 'container', className: 'note' }),
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

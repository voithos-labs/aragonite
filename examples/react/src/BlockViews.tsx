// The adapter suite's `?block-views` page (`examples/adapter-suite/requirements/block-views.md`):
// five block types drawn by React components through `reactBlock`, and an inline widget and a
// decoration badge through `reactView`.
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent,
	type ReactNode
} from 'react';
import { Aragonite, reactBlock, reactView, type BlockProps } from '@voithos-labs/aragonite-react';
import type {
	BoxDrawContext,
	ContainerDrawContext,
	Decoration,
	InlineWidgetComponentProps,
	TextDrawContext
} from '@voithos-labs/aragonite/plugin';
import {
	BLOCK_VIEWS_SOURCE,
	BOOM,
	DICE_BOOM,
	LONG_SOURCE,
	MEMO_LENGTH_ATTR,
	blockViewsPlugins,
	diceSides,
	saveNote
} from '../../adapter-suite/block-view-kinds';
import { viewMounted } from '../../adapter-suite/live-views';

const ANOTHER = '%% another memo\n\nplain text\n';

// Reaches the memo through `wrap`, as an app's theme or store provider would.
const BadgeText = createContext('no provider');

function Memo({ Slot }: BlockProps<never, TextDrawContext>) {
	return (
		<>
			<span className="memo-badge">{useContext(BadgeText)}</span>
			<span className="memo-text">
				<Slot of="source" />
			</span>
		</>
	);
}

// While open, a preview beside the text follows it as it's typed, block math's side-by-side shape.
function Label({ block, ctx, Slot }: BlockProps<never, TextDrawContext>) {
	const caption = (ctx.typed ?? block.text).slice('@@ '.length).trim();
	return (
		<>
			{!ctx.focused && <span className="label-text">{caption}</span>}
			<span className="label-source">
				<Slot of="source" />
			</span>
			{ctx.focused && <span className="label-preview">{caption}</span>}
		</>
	);
}

// `data-length` changes per edit in the box, so the slot's parent renders again while it's typed in.
function Box({ block, Slot }: BlockProps<never, ContainerDrawContext>) {
	return (
		<>
			<span className="box-badge">box by react</span>
			<div className="box-children" data-length={block.text.length}>
				<Slot of="children" />
			</div>
		</>
	);
}

// The note's text, focused whole, until a double click swaps in a textarea of its own; leaving the
// textarea writes it back, Escape drops the edit.
function Note({ block, ctx }: BlockProps<never, BoxDrawContext>) {
	const text = block.body;
	const [editing, setEditing] = useState(false);
	const box = useRef<HTMLTextAreaElement | null>(null);
	const dropped = useRef(false);
	useEffect(() => {
		if (editing) box.current?.focus();
	}, [editing]);

	function commit() {
		setEditing(false);
		if (dropped.current) return void (dropped.current = false);
		const next = box.current!.value;
		if (next + '\n' !== text) saveNote(block, ctx, next);
	}
	function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
		const field = e.currentTarget;
		if (e.key === 'Escape') {
			dropped.current = true;
			setEditing(false);
		} else if (e.key === 'ArrowUp' && !field.value.slice(0, field.selectionStart).includes('\n')) {
			e.preventDefault();
			ctx.leave('start');
		}
	}

	if (editing) {
		return (
			<textarea
				ref={box}
				className="note-source"
				defaultValue={text.replace(/\n$/, '')}
				onBlur={commit}
				onKeyDown={onKeyDown}
			/>
		);
	}
	return (
		<pre className="note-text" onDoubleClick={() => setEditing(true)}>
			{text}
		</pre>
	);
}

// A die the component draws whole: its button takes the caret, and it rolls in order, since a fair
// die would make a flaky test. ArrowRight rolls it too; ArrowUp and ArrowDown leave it. `!! boom`
// throws.
function Dice({ block, ctx }: BlockProps<never, BoxDrawContext>) {
	const sides = diceSides(block);
	const [rolled, setRolled] = useState(0);
	if (block.text.startsWith(DICE_BOOM)) throw new Error('the die went boom');
	const next = () => setRolled((n) => (n % sides) + 1);
	function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		if (e.key === 'ArrowRight') next();
		else if (e.key === 'ArrowUp') ctx.leave('start');
		else if (e.key === 'ArrowDown') ctx.leave('end');
		else return;
		e.preventDefault();
	}
	return (
		<button className="dice-roll" onClick={next} onKeyDown={onKeyDown}>
			d{sides}: {rolled || 'roll me'}
		</button>
	);
}

// Reaches the chip and the badge through `wrap`, each in a React root of its own.
const FrameworkName = createContext('no provider');
const withName = (view: ReactNode) => (
	<FrameworkName.Provider value="react">{view}</FrameworkName.Provider>
);

// `{{boom}}` throws, so a spec can see the editor contain a framework view's throw.
function Chip({ source, inline }: InlineWidgetComponentProps) {
	useEffect(viewMounted, []);
	if (source === BOOM) throw new Error('the chip went boom');
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

const plugins = blockViewsPlugins({
	memo: reactBlock(Memo, {
		className: 'memo',
		wrap: (block) => <BadgeText.Provider value="memo by react">{block}</BadgeText.Provider>
	}),
	label: reactBlock(Label, { className: 'label' }),
	box: reactBlock(Box, { className: 'box' }),
	note: reactBlock(Note, { className: 'note' }),
	dice: reactBlock(Dice, { className: 'dice' }),
	chip: reactView(Chip, { wrap: withName }),
	memoLength: reactView(MemoLength, { wrap: withName })
});

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

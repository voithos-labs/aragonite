// The adapter suite's page contract (`examples/adapter-suite/requirements/page-contract.md`).
import { useRef, useState, version } from 'react';
import { Aragonite, type EditorHandle } from '@voithos-labs/aragonite-react';
import { highlight } from '@voithos-labs/aragonite-highlight';
import { highlightJs } from '@voithos-labs/aragonite-highlight/renderer';

const FIRST = '# First note\n\nHello from the first note.\n';
const SECOND = '# Second note\n\nA different document.\n';
const LONG = Array.from({ length: 300 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n') + '\n';
// A grammar loaded with the page, and one fetched when a fence first names it.
const CODE = '```js\nconst a = 1;\n```\n\n```rust\nfn main() {}\n```\n';
// Code fences highlight as they did when the editor bundled its own grammars.
const plugins = [highlight({ renderer: highlightJs() })];

export function App({ uncontrolled }: { uncontrolled: boolean }) {
	const [loaded, setLoaded] = useState(FIRST);
	const [value, setValue] = useState(FIRST);
	const [theme, setTheme] = useState('light');
	const [themed, setThemed] = useState(true);
	const [shown, setShown] = useState(true);
	const [readOut, setReadOut] = useState('');
	const editor = useRef<EditorHandle>(null);

	function load() {
		setLoaded(SECOND);
		setValue(SECOND);
	}

	return (
		<main>
			<p data-testid="framework-version">{version}</p>
			<button data-testid="load" onClick={load}>
				Load another doc
			</button>
			<button data-testid="load-long" onClick={() => setValue(LONG)}>
				Load a long doc
			</button>
			<button data-testid="load-code" onClick={() => setValue(CODE)}>
				Load a code doc
			</button>
			<button data-testid="revert" onClick={() => setValue(loaded)}>
				Revert
			</button>
			<button data-testid="theme" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
				Theme
			</button>
			<button data-testid="drop-theme" onClick={() => setThemed(!themed)}>
				{themed ? 'Drop theme' : 'Pass theme'}
			</button>
			<button data-testid="unmount" onClick={() => setShown(!shown)}>
				{shown ? 'Unmount' : 'Mount'}
			</button>
			<button data-testid="read" onClick={() => setReadOut(editor.current?.getSource() ?? '')}>
				Read
			</button>
			{shown && (
				<Aragonite
					ref={editor}
					{...(uncontrolled ? { defaultValue: FIRST } : { value })}
					onChange={setValue}
					plugins={plugins}
					onError={(error) =>
						console.error(`${error.plugin} failed to ${error.doing}`, error.cause)
					}
					{...(themed ? { theme } : {})}
					header={<input data-testid="header-input" placeholder="Title" />}
					style={{ height: '60vh' }}
				/>
			)}
			<pre data-testid="mirror">{value}</pre>
			<pre data-testid="read-out">{readOut}</pre>
		</main>
	);
}

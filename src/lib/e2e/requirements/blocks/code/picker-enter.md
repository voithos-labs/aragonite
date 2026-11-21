# Feature: what the language picker's Enter writes

Enter takes the row the picker visibly marks, and nothing else. As the user types, a name or
alias typed exactly marks its row, and Enter writes the spelling typed; otherwise the first row
whose name or alias starts with the typed text is marked, and Enter writes its name; otherwise
nothing is marked, and Enter writes the text as typed. Rows that merely contain the typed text
stay listed, for an arrow key or a click. Each row runs by default and with every grammar opted in
(`?languages=all`).

## Happy paths

- `python` marks python and writes `python`; `pyth` marks python and writes `python`
- `py`, `sh`, `ts`, `js` mark python, bash, typescript and javascript, and write what was typed
- `c` and `java` mark and write themselves, though cpp and javascript start the same way
- `r` marks and writes ruby by default; with every grammar opted in it marks and writes `r`

## Edge cases

- `asm`, `sol`, `conf`, `log` and `zzlang` start no row: nothing is marked, and Enter writes them
  as typed, in both installs
- by default `x` and `math` start no row and are written as typed; opted in, `x` marks axapta
  (its alias `x++`) and `math` marks mathematica, and Enter takes them

## User interactions

- typing `script` marks nothing; ArrowDown marks javascript, the first row containing it, and
  Enter writes `javascript`
- typing `script` and clicking typescript writes `typescript`

## Miss-analysis

- Every Enter row typed a name the picker listed, or a prefix of one, so the first row taking
  Enter for text it merely contained (`asm` writing armasm in a 194-row list) went unseen.

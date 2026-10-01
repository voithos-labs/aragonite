# Feature: typing in an indented list

A list can start up to three spaces in. Typing in one of its items leaves that indent where it was, so every item stays a sibling.

## Happy paths

- `  - a\n  - b\n`, click `a`, End, type `Q`: the source is `  - aQ\n  - b\n`, the list still holds two items, and the source reloads as the tree the editor holds

## Edge cases

- The same keys in live mode: the same source and the same two items

## Miss-analysis

- Typing in the first item wrote `- aQ`, which nests `  - b` under it on reload, and no check fired: every list fixture started at column zero, and the keystroke ran no read-back check.

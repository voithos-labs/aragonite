# Feature: live-mode link card, from the right-click menu

A right-click on a link in live mode offers an "Edit link" row at the top of the menu. Picking it
does what Mod+K does with the caret in that link: the card opens with focus in its URL field. It's
the one mouse path to the card that works whatever click the host picked for following links (see
`plugins/wikilinks.md` for a host where a plain click follows). The card itself is
`live-link-card.md`.

## Happy paths

- Edit link on a link opens its card with focus in the URL field, holding the link's destination.
- Edit link on a bare URL pasted into a paragraph opens its card holding that URL, and a new URL
  there, then Enter, rewrites the bare URL.
  - Miss-analysis (#814): an autolink's Edit link moved the caret to the URL's end, by design,
    and no row asked whether that read as an edit to someone who pasted a link.
- A link in a table cell gets the same row at the top of the table's menu, and it opens the card.

## Edge cases

- The menu over plain text has no Edit link row; the rest of the menu is unchanged.
- Source mode shows the URL already, so the menu over a link there has no Edit link row.

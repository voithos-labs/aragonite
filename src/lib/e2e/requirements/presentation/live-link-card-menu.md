# Feature: live-mode link card, from the right-click menu

A right-click on a link in live mode offers an "Edit link" row at the top of the menu. Picking it
does what Mod+K does with the caret in that link: the card opens with focus in its URL field. It's
the one mouse path to the card that works whatever click the host picked for following links (see
`plugins/wikilinks.md` for a host where a plain click follows). The card itself is
`live-link-card.md`.

## Happy paths

- Edit link on a link opens its card with focus in the URL field, holding the link's destination.
- A link in a table cell gets the same row at the top of the table's menu, and it opens the card.

## Edge cases

- The menu over plain text has no Edit link row; the rest of the menu is unchanged.
- Source mode shows the URL already, so the menu over a link there has no Edit link row.

# Artifacts

A static index of everything I have built, plus a playable copy of the Sudoku game.

- `index.html` — the artifact index. Add new items to the `ITEMS` list at the top of its script.
- `sudoku.html` — Fifty Grids Sudoku (50 levels, 5 tiers of 10). Progress is saved in the visitor's browser.

Both files are self-contained and run on GitHub Pages: Settings → Pages → deploy from `main`, then open `/artifacts/`.

## Where play data is collected

| Version | Who can play | Data collected |
| --- | --- | --- |
| `artifacts/sudoku.html` (GitHub Pages) | Anyone | None — progress stays in the browser |
| Claude artifact | People the artifact is shared with, signed in to claude.ai | Yes, shown in the owner-only "Player data" tab |
| `/sudoku` on the Node server | Anyone who can reach the server | Yes, shown on `/admin` with CSV export |

Most links in the index point to claude.ai artifacts, which stay private until shared from each artifact's Share menu.

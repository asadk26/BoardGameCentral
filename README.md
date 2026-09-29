# Board Game Central

A home for board games played around one shared screen.

| Game | Play | Source |
|---|---|---|
| **One More Room** — one life in a 3D haunted mansion; everyone else is a ghost trying to steal it | [asadk26.github.io/BoardGameCentral/one-more-room/](https://asadk26.github.io/BoardGameCentral/one-more-room/) | [`one-more-room/`](one-more-room/) |

`index.html` is the landing page. Each game lives in its own self-contained
folder with its own `package.json`, tests and README.

The Pages site plays One More Room on one shared screen, with any mix of
people and bots. Phone controllers need the game's small room service, which
Pages cannot host and which is not hosted anywhere publicly: run it on a
laptop on your home Wi-Fi (`cd one-more-room && npm ci && npm run build &&
npm run room`), open the address it prints on the TV, and let phones scan the
QR code. See [`one-more-room/README.md`](one-more-room/README.md) for the
full procedure and Wi-Fi/firewall tips.

## Publishing

`.github/workflows/pages.yml` runs the game's tests and build on every push
and pull request. On `main` it publishes `index.html` and the built game to
GitHub Pages.

## Provenance of One More Room

One More Room was first written in the `asadk26/The_Town` repository, on the
branch `claude/one-more-room`, whose last commit was
`e8ee27f66d7646247c2cfb4842f6bdc2fc46a803`. That branch was never merged
into The_Town, and The_Town was not changed by this migration.

Migration method: the branch was cloned into a scratch copy and filtered with
`git filter-branch --index-filter … --prune-empty` so that only the
`one-more-room/` folder remained. This kept the game's two commits, with their
authors, dates and messages, as new commits in this repository:

| The_Town commit | BoardGameCentral commit | |
|---|---|---|
| `c0aabce` | `dcf03ec` | the original game |
| `e8ee27f` | `6c76b7e` | fixes from browser play-testing |

The file contents at `6c76b7e` are identical to `one-more-room/` at The_Town
`e8ee27f`. Everything after that was written here.

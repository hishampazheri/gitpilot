# GitPilot

AI-powered git workflow from your terminal. Stage files, generate commit messages, push, create PRs, and merge — all in one interactive flow. Plus a live-updating git status dashboard.

## Features

- **AI commit messages** — generates conventional commit messages from your staged diff using [Codex](https://github.com/openai/codex)
- **Interactive file staging** — select exactly which files to commit with a checkbox UI
- **Push with auto-rebase** — pulls with rebase before pushing so you never get merge commits
- **PR creation & merge** — create a GitHub PR with an AI-generated description and merge it, without leaving the terminal
- **Pretty git status** — a colored, grouped overview of your repo with a live watch mode

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Codex CLI](https://github.com/openai/codex) — `npm install -g @openai/codex`
- [GitHub CLI](https://cli.github.com/) — `brew install gh && gh auth login`

## Install

```sh
git clone https://github.com/your-username/gitpilot.git
cd gitpilot
pnpm install
pnpm build
pnpm link --global
```

## Usage

### `gcm` — commit + push + PR

Run `gcm` inside any git repo:

```
gcm
```

It walks you through:

1. **Select files** — checkboxes for staged, unstaged, and untracked files
2. **Generate message** — Codex reads the diff and writes a conventional commit message
3. **Review** — use as-is, edit, or write your own
4. **Push** — optionally push to remote (auto-rebases if needed)
5. **Create PR** — optionally create a PR with an AI-generated description
6. **Merge** — squash, merge, rebase, or leave open

### `gss` — git status

```
gss
```

Shows a clean, color-coded summary: branch, ahead/behind, staged, unstaged, and untracked files with a diff stat.

#### Watch mode

```
gss -w
```

Live-updating status in a full-screen view (like `htop`). Refreshes every 2 seconds by default.

```
gss -w --interval 5
```

Refresh every 5 seconds instead.

## License

MIT

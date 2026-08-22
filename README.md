# YNAB Dashboard

A local-first dashboard for [YNAB](https://www.ynab.com/) that adds budgeting
tools YNAB doesn't have out of the box: paycheck splitting, multi-month budget-
vs-actual reporting, a budget editor that syncs to YNAB, and an AI assistant
powered by Claude.

Everything runs on your own Mac. Your YNAB token, API keys, and financial data
never leave your machine.

## Features

- **Dashboard** — at-a-glance spending, income, and category balances
- **Transactions** — inline editing, approval workflow, hover for full charge details
- **Categories** — create, transfer between, and hide categories (synced to YNAB)
- **Income** — paycheck profiles with automatic budget splits
- **Reports** — Budget vs Actual, Budget vs Income, and Split History
- **Marie AI** — chat about your finances, auto-categorize transactions, and
  get monthly spending insights. Runs on a **local Ollama model by default**
  (free, private — your data never leaves your Mac). Claude is optional.

## Requirements

- macOS (Apple Silicon or Intel)
- [Node.js 20](https://nodejs.org/) — `brew install node@20`
- A YNAB account + [Personal Access Token](https://app.ynab.com/settings/developer)
- For Marie AI: [Ollama](https://ollama.com) (`brew install ollama`) — free & local.
  Claude is an optional alternative (paid API key).

## Quick start

```bash
git clone <your-repo-url> ynabapp
cd ynabapp
./setup.sh                       # installs deps, creates .env, installs pm2
# then edit backend/.env and add your YNAB_API_KEY
./start.sh                       # launches both services in the background
```

Open **http://localhost:5173**.

## Configuration

Edit `backend/.env`:

```
YNAB_API_KEY=your_ynab_personal_access_token   # required
YNAB_POLL_INTERVAL=120000                        # how often to sync (ms)
PORT=3001

# AI Agent
LLM_PROVIDER=ollama                              # "ollama" (local/free) or "anthropic"
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=qwen2.5:14b                         # default model
ANTHROPIC_API_KEY=sk-ant-...                     # only if LLM_PROVIDER=anthropic
```

After changing `.env`, run `pm2 restart all`.

## Marie AI (Ollama)

The agent runs on a local model so your financial data stays on your machine.

```bash
brew install ollama
brew services start ollama        # start the model server
ollama pull qwen2.5:14b           # download the default model (~9 GB, needs ~16GB+ RAM)
```

`qwen2.5` is recommended — it has the strongest tool-calling and JSON output
among local models, which the chat tools and categorizer rely on. The 14b
variant is noticeably more reliable than 7b; use 7b only on low-RAM machines.

**Switching models:** pull any model, then pick it from the dropdown in the
Marie AI page header — it switches live, no restart needed.

```bash
ollama pull qwen2.5:7b            # smaller/faster, lower quality
ollama pull llama3.1:8b           # alternative
ollama list                       # see what you've pulled
```

The selected model is remembered across restarts.

## Running in containers (optional)

The app can run fully containerized while Ollama runs natively (so it keeps GPU
acceleration — macOS containers can't use the GPU):

```bash
brew services start ollama        # native, GPU-accelerated
docker compose up --build         # backend + frontend in containers
```

The compose file points the backend at the host's Ollama via
`host.docker.internal`. Requires Docker Desktop.

## Managing the app

| Command            | What it does                          |
|--------------------|---------------------------------------|
| `./start.sh`       | Start (or restart) both services      |
| `pm2 stop all`     | Stop everything                       |
| `pm2 restart all`  | Restart after a code change           |
| `pm2 logs`         | Tail logs from both services          |

To have it launch automatically at login: `pm2 startup && pm2 save`.

## Architecture

- **frontend/** — React 18 + Vite + Mantine UI (port 5173)
- **backend/** — Express + better-sqlite3, talks to the YNAB API (port 3001)
- **backend/data/ynabapp.db** — local SQLite store for app-only data
  (budget overrides, paycheck profiles, hidden categories). Never committed.

## Security

- `.env` files and `backend/data/` are git-ignored. **Never commit them.**
- Your YNAB token grants full read/write to your budget — treat it like a password.
- The app binds to `0.0.0.0` so you can reach it from other devices on your LAN.
  If you don't want that, change `--host 0.0.0.0` in `ecosystem.config.cjs`.

## Troubleshooting

**`better-sqlite3` fails to install** — you're likely on a Node version newer
than 22. Install Node 20 (`brew install node@20`) and re-run `./setup.sh`.

**Blank page / stale UI** — `pm2 restart all`, then hard-refresh (`Cmd+Shift+R`).

# macOS build/runtime dependencies for YNAB Dashboard.
# Install everything with:  brew bundle
# (setup.sh runs this for you.)

# Node.js 20 — required. better-sqlite3 (native module) does not build on
# newer Node majors. node@20 is keg-only; setup.sh/start.sh put it on PATH.
brew "node@20"

# Native npm modules (better-sqlite3) fall back to compiling from source when
# no prebuilt binary matches; that needs Xcode Command Line Tools (clang, make,
# python3), which Homebrew itself already requires:  xcode-select --install

# Local LLM runtime for Marie AI (default provider). Optional if you use
# LLM_PROVIDER=anthropic instead.
brew "ollama"

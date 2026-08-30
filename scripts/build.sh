#!/bin/sh
set -e
# Resolve the project root from this script's location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$PROJECT_ROOT/node_modules/.bin:$PATH"
cd "$PROJECT_ROOT"
exec vite build

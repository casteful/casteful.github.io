#!/usr/bin/env bash
# DTEK Odesa shutdown schedule app - macOS / Linux launcher
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3.9+ is required (https://www.python.org/downloads/)."
    exit 1
fi

if ! python3 -c 'import curl_cffi' >/dev/null 2>&1; then
    echo "Installing curl_cffi (recommended for the DTEK site's bot protection)..."
    pip3 install --user curl_cffi || pip3 install curl_cffi || true
fi

exec python3 dtek_shutdown_app.py "$@"

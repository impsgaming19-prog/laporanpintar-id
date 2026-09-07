#!/bin/sh
set -eu
cd "$(dirname "$0")"
echo "== compile =="
python3 -m py_compile botdeploy/v2_nokos.py
echo "compile OK"
echo "== smoke (inline demo) =="
NOKOS_API_KEY=demo NOKOS_MARKUP_PCT=30 python3 botdeploy/v2_nokos.py
echo "smoke OK"
echo "== targeted tests =="
NOKOS_API_KEY=demo NOKOS_MARKUP_PCT=30 python3 botdeploy/v2_nokos_case.py
echo "targeted OK"

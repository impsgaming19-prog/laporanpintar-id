"""
Runner kecil untuk Nokos compile + smoke + targeted tests.

Jalankan: python3 botdeploy/v2_nokos_test.py
atau langsung: bash run_tests.sh
"""

import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
os.chdir(str(REPO_ROOT))

HERE_REL = str(SCRIPT_DIR.relative_to(REPO_ROOT))


def run(command, env=None):
    merged = dict(os.environ)
    if env:
        merged.update(env)
    print(f"$ {command}")
    return subprocess.call(
        command,
        shell=True,
        cwd=str(REPO_ROOT),
        env=merged,
    )


def main() -> int:
    rc = 0

    rc |= run(
        "python3 -m py_compile botdeploy/v2_nokos.py",
        env={"NOKOS_API_KEY": "demo", "NOKOS_MARKUP_PCT": "30"},
    )
    if rc:
        print("FAIL compile")
        return 1
    print("compile OK\n")

    rc |= run(
        "bash run_tests.sh",
        env={"NOKOS_API_KEY": "demo", "NOKOS_MARKUP_PCT": "30"},
    )
    if rc:
        print("FAIL run_tests")
        return 1
    print("run_tests OK\n")

    return rc


if __name__ == "__main__":
    raise SystemExit(main())

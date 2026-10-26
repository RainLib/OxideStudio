#!/usr/bin/env python3
"""Build an isolated, repeatable SQLite sharing workspace using only the stdlib."""
import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "demos" / "sharing"


def verify(connection):
    assert connection.execute("PRAGMA integrity_check").fetchone() == ("ok",)
    assert not connection.execute("PRAGMA foreign_key_check").fetchall()
    assert connection.execute(
        "SELECT id, name, score FROM share_demo WHERE score >= 80 ORDER BY score DESC"
    ).fetchall() == [(2, "Bob", 92), (1, "Alice", 86)]
    assert connection.execute(
        "SELECT id, total_cents FROM paid_order_totals ORDER BY total_cents DESC"
    ).fetchall() == [(102, 129900), (105, 75700), (101, 49700)]
    return {name: connection.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            for name in ("share_demo", "products", "orders", "order_items",
                         "demo_notes", "schema_sandbox")}


def prepare(workspace, reset=False):
    workspace = Path(workspace).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    database = workspace / "oxide-sharing.sqlite"
    existing_counts = None
    if database.exists():
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
            try:
                marker = connection.execute(
                    "SELECT fixture, version FROM demo_manifest WHERE id = 1"
                ).fetchone()
            except sqlite3.DatabaseError as error:
                raise ValueError("Refusing to replace an unrecognized database") from error
            if marker != ("oxide-sharing", 1):
                raise ValueError("Refusing to replace an unrecognized database")
            if not reset:
                existing_counts = verify(connection)
        if reset and any(Path(str(database) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
            raise ValueError("Disconnect the demo database before resetting it")
    counts = existing_counts
    if counts is None:
        if database.exists() and shutil.which("lsof"):
            opened = subprocess.run(["lsof", "-t", str(database)], capture_output=True,
                                    text=True, timeout=10)
            if opened.returncode not in (0, 1):
                raise ValueError("Unable to check open database handles; disconnect it before resetting")
            if any(pid != str(os.getpid()) for pid in opened.stdout.split()):
                raise ValueError("Disconnect the demo database before resetting it")
        fd, temporary = tempfile.mkstemp(prefix=".sharing-", suffix=".sqlite", dir=workspace)
        os.close(fd)
        try:
            with closing(sqlite3.connect(temporary)) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.executescript((FIXTURES / "sql" / "00-seed.sql").read_text())
                counts = verify(connection)
            os.replace(temporary, database)
        finally:
            Path(temporary).unlink(missing_ok=True)
    for directory in ("sql", "data"):
        shutil.copytree(FIXTURES / directory, workspace / directory, dirs_exist_ok=True)
    shutil.copy2(FIXTURES / "PLAN-PROMPT.txt", workspace / "PLAN-PROMPT.txt")
    shutil.copy2(FIXTURES / "README.md", workspace / "README.md")
    report = {"database": str(database), "rows": counts, "reset": reset}
    (workspace / "fixture-verification.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, default=ROOT / "output/sharing-demo/workspace")
    parser.add_argument("--reset", action="store_true", help="Replace only a recognized demo fixture")
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.workspace, args.reset), ensure_ascii=False, indent=2))
    except AssertionError:
        parser.exit(1, "Demo data differs from the fixture. Disconnect it and use --reset to restore synthetic data.\n")
    except (ValueError, sqlite3.DatabaseError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"Demo preparation failed: {error}\n")

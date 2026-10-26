import importlib.util
from pathlib import Path
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "sharing", Path(__file__).with_name("prepare-sharing-demo.py")
)
sharing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sharing)


class SharingFixtureTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("lsof"), "Open-handle detection requires lsof")
    def test_refuse_reset_while_another_process_holds_database(self):
        with tempfile.TemporaryDirectory() as directory:
            report = sharing.prepare(directory)
            child = subprocess.Popen([
                sys.executable, "-c",
                "import sqlite3,sys,time; c=sqlite3.connect(sys.argv[1]); "
                "c.execute('SELECT * FROM share_demo').fetchall(); "
                "print('ready',flush=True); time.sleep(30)",
                report["database"],
            ], stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "ready")
                with self.assertRaisesRegex(ValueError, "Disconnect"):
                    sharing.prepare(directory, reset=True)
            finally:
                child.terminate()
                child.wait(timeout=5)
                child.stdout.close()

    def test_edit_reset_and_unknown_database_protection(self):
        with tempfile.TemporaryDirectory() as directory:
            report = sharing.prepare(directory)
            self.assertEqual(report["rows"]["order_items"], 8)
            database = Path(report["database"])
            with sqlite3.connect(database) as connection:
                connection.execute("UPDATE share_demo SET score = 95 WHERE id = 2")
            with self.assertRaises(AssertionError):
                sharing.prepare(directory)
            sharing.prepare(directory, reset=True)
            with sqlite3.connect(database) as connection:
                self.assertEqual(connection.execute(
                    "SELECT score FROM share_demo WHERE id = 2"
                ).fetchone(), (92,))
                connection.execute("DROP TABLE demo_manifest")
            original = database.read_bytes()
            with self.assertRaisesRegex(ValueError, "unrecognized"):
                sharing.prepare(directory, reset=True)
            self.assertEqual(database.read_bytes(), original)

    def test_refuse_reset_with_live_wal(self):
        with tempfile.TemporaryDirectory() as directory:
            report = sharing.prepare(directory)
            Path(report["database"] + "-wal").touch()
            with self.assertRaisesRegex(ValueError, "Disconnect"):
                sharing.prepare(directory, reset=True)

    def test_query_edit_restore_and_schema_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            report = sharing.prepare(directory)
            with sqlite3.connect(report["database"]) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("UPDATE share_demo SET score = 95 WHERE id = 2")
                connection.commit()
                connection.executescript((sharing.FIXTURES / "sql/03-reset-grid.sql").read_text())
                sharing.verify(connection)
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute("UPDATE share_demo SET score = 101 WHERE id = 2")
                connection.rollback()
                with self.assertRaises(sqlite3.IntegrityError):
                    connection.execute("INSERT INTO order_items VALUES (999, 1, 1, 100)")
                connection.rollback()
                connection.execute("BEGIN")
                connection.execute("ALTER TABLE schema_sandbox ADD COLUMN demo_tag TEXT")
                connection.rollback()
                self.assertEqual([r[1] for r in connection.execute(
                    "PRAGMA table_info(schema_sandbox)"
                )], ["id", "label"])


if __name__ == "__main__":
    unittest.main()

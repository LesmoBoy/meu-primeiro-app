#!/usr/bin/env python3
"""Offline reconstruction only. Never connects to a database or publishes."""
import hashlib
import io
import json
import pathlib
import re
import subprocess
import tarfile
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE = "8f4cae36367f667ca871bd2539891ad6d1a74599"
archive = subprocess.check_output(["git", "archive", BASE], cwd=ROOT)
with tempfile.TemporaryDirectory(prefix="rodagem-rollback-dry-run-") as directory:
    target = pathlib.Path(directory)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tree:
        tree.extractall(target, filter="data")
    sw = target / "sw.js"
    source = sw.read_text()
    old_name = "3.2.2"
    new_name = "3.2.2-rollback-v323-dry-run"
    assert "const CACHE = PREFIXO + '3.2.2';" in source
    sw.write_text(source.replace("PREFIXO + '3.2.2'", "PREFIXO + '" + new_name + "'"))
    paths = re.findall(r"'\.\/(.*?)'", source.split("const ARQUIVOS =", 1)[1].split(";", 1)[0])
    assert len(paths) == len(set(paths)) == 39
    assert all((target / item).is_file() for item in paths)
    # Adapt only the expected cache key in the baseline test. Its old cache,
    # cross-scope preservation and fallback assertions are left intact.
    test = target / "qa/sw-test.cjs"
    test.write_text(test.read_text().replace("prefix+'3.2.2'", "prefix+'" + new_name + "'"))
    run = subprocess.run(["node", "qa/sw-test.cjs"], cwd=target, text=True, capture_output=True, timeout=30)
    assert run.returncode == 0, run.stdout + run.stderr
    result = {
        "classification": "local-offline-rollback-reconstruction-and-simulated-cache",
        "baseCommit": BASE,
        "productionRollbackExecuted": False,
        "databaseAccess": False,
        "runtimeFiles": len(paths) + 1,
        "newCacheIdentifier": new_name,
        "baselineCacheRegressionExitCode": run.returncode,
        "baselineCacheRegressionSuites": 10,
        "runtimeManifest": {item: hashlib.sha256((target / item).read_bytes()).hexdigest() for item in sorted(paths + ["sw.js"])},
        "limit": "Does not deploy Pages, control old tabs, restore user data or prove physical/offline browser behavior."
    }
(ROOT / "qa/v323/rollback-dry-run-report.json").write_text(json.dumps(result, indent=2) + "\n")
print("PASS offline rollback reconstruction, 40 runtime files, 10 simulated cache suites; production untouched")

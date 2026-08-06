#!/usr/bin/env python3
"""Scan text artifacts without echoing suspected secret values."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys
from typing import Iterable


SKIP_PARTS = {".git", ".venv", "__pycache__", "node_modules"}
SECRET_ASSIGNMENT = re.compile(
    r"(?i)[\"']?(?:SJ_API_KEY|SJ_SEC_KEY|SHIOAJI_API_KEY|SHIOAJI_SECRET_KEY|"
    r"CLOUDFLARE_INGEST_SECRET)[\"']?\s*(?:=|:)\s*[\"']?([^\"'\s#,}]+)"
)
SENSITIVE_HEADER = re.compile(
    r"(?i)[\"']?(?:authorization|proxy-authorization|cookie|set-cookie)[\"']?"
    r"\s*[:=]\s*[\"']?([^\"'\s,}]+)"
)
ACCOUNT_ASSIGNMENT = re.compile(
    r"(?i)[\"']?(?:person_id|account_id)[\"']?\s*[:=]\s*[\"']"
    r"([A-Za-z0-9_-]{6,})[\"']"
)
PRIVATE_KEY_MARKER = re.compile("BEGIN " + r"(?:RSA |EC |OPENSSH )?" + "PRIVATE KEY")
SAFE_PREFIXES = (
    "fixture-",
    "YOUR_",
    "${",
    "<",
    "[REDACTED_",
)
SAFE_SECRET_REFERENCES = (
    "/etc/credstore.encrypted/",
    "%d/",
)


@dataclass(frozen=True)
class Finding:
    path: Path
    line: int
    reason_code: str


def _is_placeholder(value: str) -> bool:
    return value.startswith(SAFE_PREFIXES)


def scan_text(path: Path, text: str) -> list[Finding]:
    findings: list[Finding] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        assignment = SECRET_ASSIGNMENT.search(line)
        if assignment and not (
            _is_placeholder(assignment.group(1))
            or assignment.group(1).startswith(SAFE_SECRET_REFERENCES)
        ):
            findings.append(Finding(path, line_number, "sensitive_assignment"))
        header = SENSITIVE_HEADER.search(line)
        if header and not _is_placeholder(header.group(1)):
            findings.append(Finding(path, line_number, "sensitive_header"))
        account = ACCOUNT_ASSIGNMENT.search(line)
        if account and not _is_placeholder(account.group(1)):
            findings.append(Finding(path, line_number, "account_identifier"))
        if PRIVATE_KEY_MARKER.search(line):
            findings.append(Finding(path, line_number, "private_key_material"))
    return findings


def iter_files(inputs: Iterable[Path]) -> Iterable[Path]:
    for item in inputs:
        if item.is_file():
            yield item
            continue
        if not item.is_dir():
            continue
        for path in item.rglob("*"):
            if path.is_file() and not SKIP_PARTS.intersection(path.parts):
                yield path


def scan_paths(inputs: Iterable[Path]) -> tuple[int, list[Finding]]:
    scanned = 0
    findings: list[Finding] = []
    for path in iter_files(inputs):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        scanned += 1
        findings.extend(scan_text(path, text))
    return scanned, findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scan gateway artifacts without printing values")
    parser.add_argument("paths", nargs="+", type=Path)
    options = parser.parse_args(argv)
    scanned, findings = scan_paths(options.paths)
    if findings:
        for finding in findings:
            print(
                f"safe-artifact-scan: fail path={finding.path} "
                f"line={finding.line} reason={finding.reason_code}",
                file=sys.stderr,
            )
        return 1
    print(f"safe-artifact-scan: pass files={scanned}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

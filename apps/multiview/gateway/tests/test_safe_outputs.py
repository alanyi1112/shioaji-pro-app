from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

from multichart_gateway.runtime_config import GatewayStartupError
from multichart_gateway.safe_logging import SafeLogger, safe_reason_code


SCANNER_PATH = Path(__file__).parents[1] / "tools" / "scan_safe_artifacts.py"
SPEC = importlib.util.spec_from_file_location("safe_artifact_scanner", SCANNER_PATH)
assert SPEC is not None and SPEC.loader is not None
SCANNER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SCANNER
SPEC.loader.exec_module(SCANNER)


class SafeLoggingTests(unittest.TestCase):
    def test_logger_emits_only_allowlisted_fields(self) -> None:
        lines: list[str] = []
        logger = SafeLogger(lines.append)
        logger.emit(
            "provider_state",
            phase="login",
            state="simulation",
            count=2,
            reasonCode="none",
        )
        payload = json.loads(lines[0])
        self.assertEqual(payload["event"], "provider_state")
        self.assertEqual(payload["count"], 2)
        self.assertNotIn("headers", payload)
        self.assertNotIn("environment", payload)

    def test_logger_rejects_unknown_fields_and_unstructured_values(self) -> None:
        logger = SafeLogger(lambda _: None)
        with self.assertRaisesRegex(GatewayStartupError, "^unsafe_log_field$"):
            logger.emit("provider_state", headers="fixture-header")
        with self.assertRaisesRegex(GatewayStartupError, "^unsafe_log_value$"):
            logger.emit("provider_state", reasonCode="unsafe value with spaces")

    def test_unknown_exception_message_is_not_returned(self) -> None:
        error = RuntimeError("sensitive-marker-must-not-appear")
        self.assertEqual(safe_reason_code(error), "internal_error")
        self.assertNotIn("sensitive-marker", safe_reason_code(error))


class ArtifactScannerTests(unittest.TestCase):
    def test_scans_source_fixture_artifact_log_and_health_without_echoing_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            safe_files = {
                "source.py": 'mode = "simulation"\n',
                "fixture.json": '{"api":"fixture-api-key"}\n',
                "artifact.js": 'const state = "live";\n',
                "service.log": '{"event":"provider_state","reasonCode":"none"}\n',
                "health.json": '{"started":true,"subscriptionCount":2}\n',
            }
            for name, content in safe_files.items():
                (root / name).write_text(content, encoding="utf-8")
            scanned, findings = SCANNER.scan_paths([root])
            self.assertEqual(scanned, 5)
            self.assertEqual(findings, [])

            leaked_value = "unsafe-" + "material-should-not-be-printed"
            (root / "service.log").write_text(
                "SJ_API" + "_KEY=" + leaked_value + "\n",
                encoding="utf-8",
            )
            _, findings = SCANNER.scan_paths([root])
            self.assertEqual(len(findings), 1)
            self.assertEqual(findings[0].reason_code, "sensitive_assignment")
            self.assertNotIn(leaked_value, repr(findings[0]))

    def test_detects_header_account_and_private_key_by_reason_only(self) -> None:
        text = "\n".join(
            (
                '{"authoriz' + 'ation":"Bearer-value-that-is-not-a-placeholder"}',
                '{"person_' + 'id":"A123456789"}',
                "-----" + "BEGIN " + "PRIVATE" + " KEY" + "-----",
            )
        )
        findings = SCANNER.scan_text(Path("artifact.txt"), text)
        self.assertEqual(
            [finding.reason_code for finding in findings],
            ["sensitive_header", "account_identifier", "private_key_material"],
        )
        self.assertNotIn("Bearer-value", repr(findings))
        self.assertNotIn("A123456789", repr(findings))


if __name__ == "__main__":
    unittest.main()

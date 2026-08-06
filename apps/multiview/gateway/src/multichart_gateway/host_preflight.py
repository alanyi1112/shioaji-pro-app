"""Safe host preflight for the systemd service."""

from __future__ import annotations

import subprocess

from .safe_logging import SafeLogger


def verify_time_sync() -> bool:
    try:
        result = subprocess.run(
            ["/usr/bin/timedatectl", "show", "--property=NTPSynchronized", "--value"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and result.stdout.strip() == "yes"


def main() -> int:
    logger = SafeLogger()
    if not verify_time_sync():
        logger.emit(
            "host_preflight",
            phase="time_sync",
            state="blocked",
            reasonCode="ntp_not_synchronized",
        )
        return 1
    logger.emit(
        "host_preflight",
        phase="time_sync",
        state="ready",
        reasonCode="none",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

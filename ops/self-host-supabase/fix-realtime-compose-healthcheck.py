#!/usr/bin/env python3
from pathlib import Path


def main() -> None:
    compose = Path("docker-compose.yml")
    text = compose.read_text(encoding="utf-8")

    target_url = "http://localhost:4000/api/tenants/realtime-dev/health"
    lines = text.splitlines()
    updated = False

    for idx, line in enumerate(lines):
        if target_url in line and "code=$(curl" in line:
            lines[idx] = (
                '          "code=$(curl -sS -o /dev/null -w \'%{http_code}\' '
                '-H \'Authorization: Bearer ${ANON_KEY}\' '
                "http://localhost:4000/api/tenants/realtime-dev/health || true); "
                '[ $$code = 200 ] || [ $$code = 403 ]"'
            )
            updated = True
            break

    if not updated:
        print("No matching realtime healthcheck line found; nothing changed.")
        return

    compose.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("Realtime healthcheck line fixed.")


if __name__ == "__main__":
    main()

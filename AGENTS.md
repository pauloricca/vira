# Development environment

Run dependency installation, compilation, code formatting, tests, media preparation,
and offline experiments in Docker. Do not install project toolchains on the host.
The built macOS executable runs on bare metal for Core Audio/device measurements.
The audio spike includes a container cross-compiler using a read-only local Apple SDK.
Container timings are not macOS acceptance evidence.

# App preview after changes

After every change to VIRA, rebuild `app/output/VIRA.app` in Docker before
reporting completion, so Paulo can open the updated app and inspect the result.
Use `app/scripts/build-app.sh` when the preparation service and app launch are
needed; for code-only changes, the Docker `builder` service can rebuild the app.
Do not treat a frontend-only build as an updated `.app`.

# Keyboard shortcuts

Whenever a shortcut is added, removed, or modified, update the in-app Shortcuts
page (`app/frontend/Shortcuts.tsx`) in the same change. Keep its table complete
and accurate, including each shortcut's action and availability conditions.

# Deployment

When Paulo requests a web-app deployment, default to Faffless and follow
`/Users/pauloricca/.codex/skills/faffless-deploy/SKILL.md`. Preserve unrelated work.

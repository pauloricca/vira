# Development environment

Run dependency installation, compilation, code formatting, tests, media preparation,
and offline experiments in Docker. Do not install project toolchains on the host.
The built macOS executable runs on bare metal for Core Audio/device measurements.
The audio spike includes a container cross-compiler using a read-only local Apple SDK.
Container timings are not macOS acceptance evidence.

# Deployment

When Paulo requests a web-app deployment, default to Faffless and follow
`/Users/pauloricca/.codex/skills/faffless-deploy/SKILL.md`. Preserve unrelated work.

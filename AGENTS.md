# Repository Guidelines

## Project Structure & Module Organization

This workspace currently contains `報修需求筆記.txt`, the requirements for a small repair-reporting demo. There is no application code, test suite, package manifest, or Git metadata yet. Read the note before implementing features.

Planned deliverables include a web form and report list, Supabase tables and access rules, an Excel field specification, a six-slide proposal, and a Word user guide. When implementation begins, group application code in `src/`, tests in `tests/`, database scripts in `supabase/`, and supporting documents in `docs/`. These directories are proposed conventions, not existing infrastructure.

## Build, Test, and Development Commands

No build, development, lint, or test commands are configured. Do not assume that `npm test` or `npm run build` works. When selecting a framework, document installation, local startup, build, and test commands in a README and define their scripts in the appropriate project manifest.

## Coding Style & Naming Conventions

Preserve Traditional Chinese terminology in user-facing text. Keep category, urgency, and status values consistent with the requirements note. Use descriptive identifiers and consistent indentation within each file. No formatter or linter is currently configured; document any tools introduced with the application.

## Testing Guidelines

No testing framework or coverage threshold exists. Future tests should cover required-field validation, report creation, list rendering, automatic registration timestamps, and database access rules. Use descriptive test names such as `rejects_empty_problem_description`. Verify that anonymous clients can insert and read reports but cannot update or delete them.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. If Git is initialized, use concise, imperative commit messages such as `Add report submission form`. Pull requests should explain the change, reference the relevant requirement, state validation performed, and include screenshots for visible interface changes.

## Security & Scope

Use fictional names and locations only. Enable Supabase row-level security before exposing data through the frontend. Never commit privileged keys or credentials. The initial demo supports creation and listing without login; status editing, authentication, and notifications require a separate scope decision.

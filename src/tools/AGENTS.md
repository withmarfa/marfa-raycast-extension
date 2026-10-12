# AI tools

The tools in this folder and their instructions and evals in `ai.yaml`. The root and `src/AGENTS.md` still apply.

- Each tool goes through the same door and validation as the commands. `capture-item` uses the capture form's plan and validator and runs behind a confirmation that names the type and each value.
- A tool's input is one object type with JSDoc on each field. Raycast generates the model-facing schema from it, so the JSDoc is the model's instructions.
- A tool turns a failure into the same words a view shows, so the model can say what to change.
- `search-items` returns full rows (name, text, tags, when it changed) so the model answers without a second call.
- An eval asserts only what Raycast's documented matcher grammar covers, such as `includes` on a string and a dotted path into an argument (`properties.0.name`). A guessed syntax errors or matches nothing, and a matcher that matches nothing passes.

## Code Review Rules

- **Undocumented input.** Flag a tool input field without JSDoc, or JSDoc that disagrees with what the tool accepts.
- **Unconfirmed write.** Flag a tool that writes without a confirmation naming what it writes, or skips the capture form's validation.
- **Vacuous eval.** Flag an eval assertion outside the documented matcher grammar.

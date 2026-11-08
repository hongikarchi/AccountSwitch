// SPEC 3.8 part 4: the text written between the markers of ~/.claude/CLAUDE.md and
// ~/.codex/AGENTS.md. The check compares it too, so a note from an older version is written again.

/** Part 4's text. It is read by Claude Code and Codex, so English, like every agent-facing note. */
export function roleNote() {
  return [
    '## Rhino tools (written by AccountSwitch)',
    '',
    '- Use `rhino` (rhinomcp) for scripts and measurements in the Rhino document.',
    '- Use `cordyceps` for Grasshopper and for how the viewport looks.',
    '- rhinomcp listens only after its `mcpstart` command runs in Rhino. If `rhino` does not answer, ask the user to type `mcpstart` in Rhino.',
    '- Cordyceps starts when its component is on a Grasshopper canvas. If `cordyceps` does not answer, ask the user to open Grasshopper and place the Cordyceps component.',
    '- Never kill Rhino by process name. A killed Rhino leaves `.rhl` lock files that make files open read-only.',
  ].join('\n');
}

/** Whether a note file holds the current text between the markers (any line endings). */
export function hasRoleNote(file: string, start: string, end: string) {
  return file.replace(/\r\n/g, '\n').includes(`${start}\n${roleNote()}\n${end}`);
}

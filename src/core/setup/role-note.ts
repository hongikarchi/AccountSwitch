// SPEC 3.8 part 4: the text written between the markers of ~/.claude/CLAUDE.md and
// ~/.codex/AGENTS.md. The check compares it too, so a note from an older version is written again.

/** Part 4's text. It is read by Claude Code and Codex, so English, like every agent-facing note. */
export function roleNote() {
  return [
    '## Rhino tools (written by AccountSwitch)',
    '',
    '- Use `rhino` (rhinomcp) for scripts and measurements in the Rhino document.',
    '- Use `cordyceps` for Grasshopper and for how the viewport looks.',
    '- rhinomcp starts with Rhino. If `rhino` does not answer, ask the user to open Rhino, or to close and reopen a Rhino that was open before setup. Do not ask for `mcpstart` or `mcpwindow` by hand: in rhinomcp 0.5.x they start a tray program that keeps the open file locked, so saving it fails.',
    '- Cordyceps starts when the user opens Grasshopper and places the Cordyceps component on the canvas. A session only connects to it if it was running when the session started. If `cordyceps` is not connected, ask the user to open Grasshopper, place the Cordyceps component, and then reconnect: in Claude Code type `/mcp` and reconnect `cordyceps`; in Codex start a new session. Until then use `rhino` for Grasshopper.',
    '- Never kill Rhino by process name. A killed Rhino leaves `.rhl` lock files that make files open read-only.',
  ].join('\n');
}

/** Whether a note file holds the current text between the markers (any line endings). */
export function hasRoleNote(file: string, start: string, end: string) {
  return file.replace(/\r\n/g, '\n').includes(`${start}\n${roleNote()}\n${end}`);
}

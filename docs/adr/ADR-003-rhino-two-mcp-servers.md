# ADR-003 Offer both rhinomcp and Cordyceps, with separate roles

Status: accepted, 2026-11-06 (Rhino settings item accepted the same day, SPEC 3.8)

## Context

Users want Claude Code to control both Rhino and Grasshopper. Modeling itself is written as scripts; MCP is used to run those scripts in the open application and to see the result. Earlier, with both plugins installed, files sometimes could not be saved or opened read-only, and the user suspected a conflict.

Investigation (decompiled rhinomcp 0.4.1.1 and Cordyceps 1.5.0, read both repositories' issues):

- rhinomcp listens on TCP `127.0.0.1:1999` after the Rhino command `mcpstart`. Its tools cover the Rhino document: run Python or C# code in the open document, object queries, measurements and analysis, selection, viewport capture, undo and redo, and basic Grasshopper tools.
- Cordyceps listens on HTTP `:26929` once its component is on a Grasshopper canvas. Its tools are Grasshopper-first (canvas, wires, script components, inspection), plus Rhino scene (objects, layers, selection, visibility, command macros) and render/view settings, and viewport capture.
- Neither opens, writes, or locks `.3dm` files, hooks save events, or shares a port or state with the other. No read-only or save failure reports in either repository.
- The likely cause of the save problem was Rhino's own lock files (`<file>.3dm.rhl`) left by Rhino processes that were killed, combined with the read-only warning being turned off in Rhino options, so locked files opened read-only silently. Files on a shared drive opened by a colleague behave the same.

## Decision

- Offer both. Roles: **rhinomcp** runs scripts and queries in the Rhino document (the hands for document-level scripts, plus measurements and undo). **Cordyceps** drives Grasshopper and the viewport look (the eyes and the canvas).
- Each can be unchecked in the wizard.
- The wizard turns the read-only warning back on, runs `mcpstart` at Rhino start, provides a Grasshopper starter file with the Cordyceps component (Claude can open it through rhinomcp, which starts Cordyceps), and writes a short tool-role note to `~/.claude/CLAUDE.md` (SPEC 3.8). All four edit files only while Rhino is closed.
- Agents and tests never kill Rhino by process name.

## Consequences

- Two MCP servers expose overlapping Grasshopper tools; the role note reduces wrong picks.
- Running two Rhino instances makes the second unable to listen; the agent then talks to the first.

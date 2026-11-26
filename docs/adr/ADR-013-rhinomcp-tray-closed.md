# ADR-013 Close rhinomcp's tray program when Rhino starts

Status: accepted, 2026-11-26 (#37, SPEC 3.8 part 5)

## Context

Saving a `.3dm` in Rhino failed and the file turned read-only. On the development PC (2026-11-26) Windows Restart Manager named `RhinoMCPTray.exe`, a child of `Rhino.exe`, as the only process holding the open `.3dm`.

- rhinomcp 0.5.x ships `RhinoMCPTray.exe` next to the plugin: one status icon and window for all running Rhino instances. 0.4.1.1 had none, so ADR-003's finding ("neither plugin opens or locks `.3dm` files") was true then.
- The plugin starts it from `mcpstart`, and again from `mcpwindow` (`plugin/StatusTray.cs`, `RhinoMCPServerController.cs`), with `UseShellExecute = false`. The tray inherits Rhino's inheritable handles at that moment, which include a file Rhino opened at start (double-clicked). Files opened later are not inherited.
- One tray runs per Windows session (a named mutex); a second start exits at once. The tray quits by itself 20 s after no Rhino runs a server, and has a "close icon" menu item, so closing it is a supported state. The MCP server runs inside Rhino and does not need the tray.
- The plugin has no setting or environment variable to leave the tray out. Reported upstream, not fixed yet: https://github.com/jingcheng-chen/rhinomcp/issues/81
- The user chose closing the tray automatically (2026-11-26).

## Decision

- Rhino's start commands, which the wizard already sets to `_mcpstart` (SPEC 3.8 part 2), get one more command after it: an inline `_-RunPythonScript (...)` that kills the `RhinoMCPTray` processes in Rhino's own Windows session, through .NET's `Process`, so no helper program is started that could inherit the handles too. The text is fixed in `src/core/setup/rhinomcp-tray.ts`.
- It is inline, not a script file, so there is no second file to install, check, or find missing. Measured on Rhino 8 (2026-11-26, a listing run in the open Rhino, nothing killed): Rhino's macro reader keeps spaces, nested brackets and single quotes inside the brackets. The text holds no `<`, `>`, `&` or `"`, so it sits in the settings XML without escapes.
- Rhino runs it each time it starts, so it survives plugin updates, which Rhino installs by itself. The wizard never stops a process itself.

Dropped:

- Deleting or renaming `RhinoMCPTray.exe` in the package folder: the plugin then skips it, but Rhino's next package update brings it back without the user noticing, and it edits another program's install.
- Killing the tray from AccountSwitch (the engine or the launcher): it does not run when the user double-clicks a `.3dm`.

## Consequences

- No rhinomcp status icon on the taskbar. A killed tray can leave its icon on the taskbar until the mouse passes over it.
- `mcpwindow`, or `mcpstop` then `mcpstart` by hand, start the tray again with the files open at that moment; closing and reopening Rhino clears it. The tool-role note (SPEC 3.8 part 4) tells agents not to ask for those commands and to ask for a Rhino restart instead.
- PCs set up before this see `rhino-settings` open again until it runs once more with Rhino closed.
- Removal: once rhinomcp stops passing its handles to the tray, a later version removes this exact text from `StartupCommands` (it appears nowhere else) and drops part 5.

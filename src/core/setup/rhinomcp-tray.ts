// SPEC 3.8 part 5, ADR-013: rhinomcp 0.5.x starts its tray program (RhinoMCPTray.exe) from
// `mcpstart` with `UseShellExecute = false`, so the tray inherits Rhino's handles, among them the
// .3dm Rhino opened at start, and Rhino can no longer save over it
// (https://github.com/jingcheng-chen/rhinomcp/issues/81). This Rhino start command, run right after
// `_mcpstart`, closes the trays of this Windows session; the server inside Rhino keeps running.
//
// The text is fixed and appears nowhere else, so a later version can find it in Rhino's start
// commands and take it out once rhinomcp is fixed. It is a single line that Rhino's macro reader
// takes whole (measured on Rhino 8, 2026-11-26: spaces, nested brackets and single quotes inside
// the brackets survive), and it holds no `<`, `>`, `&` or `"`, so the settings file needs no escapes.

export const TRAY_PROCESS = 'RhinoMCPTray';

/** Kills only trays in the session Rhino runs in; one that already left is skipped. */
export const CLOSE_TRAY_COMMAND =
  "_-RunPythonScript (import System;P=System.Diagnostics.Process;s=P.GetCurrentProcess().SessionId;[p.Kill() for p in P.GetProcessesByName('" +
  TRAY_PROCESS +
  "') if p.SessionId==s and not p.HasExited])";

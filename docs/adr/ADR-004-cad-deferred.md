# ADR-004 CAD (ZWCAD, AutoCAD) is not in 0.3.0; when added, only live-application control

Status: accepted, 2026-11-06

## Context

The user's office uses ZWCAD. Drawings depend on external references, dimension styles, blocks with attributes and dynamic blocks, layouts and viewports, and annotative scales. Regenerating DWG or DXF files (for example with ezdxf, plus ODA conversion for DWG) can lose or damage these when drawings are shared with other offices.

Research (2026-11-06): AutoCAD (full) and ZWCAD Professional expose COM, so one Python bridge can drive both; ZWCAD Standard and AutoCAD LT expose LISP only. Autodesk's own AutoCAD MCP works only with Autodesk Assistant, not Claude Code. Community MCP servers are early-stage single-author projects; the most used COM-based one supports AutoCAD, ZWCAD and GstarCAD but has no xref or layout tools. No CAD application is installed on the development PC.

## Decision

- 0.3.0 ships without a CAD group.
- When added, CAD support controls the running application only (the application saves the drawing). No file regeneration of shared drawings.
- Safety defaults when added: work on a copy, no automatic save, every arbitrary command or LISP execution needs approval, server pinned to a reviewed commit, stdio only.

## Next

The office uses **ZWCAD Professional** (user, 2026-11-06), so the route is COM (ProgID with version, e.g. `ZWCAD.Application.2025`, **verify**), and a COM-based server that targets both AutoCAD and ZWCAD is the first candidate. Test on a PC with ZWCAD: connection and ProgID, Korean layer and text names, and whether an edited drawing opens unchanged in a partner's AutoCAD (xref paths, dimension overrides, annotative scales, dynamic block states).

// SPEC 3.3 `blender-mcp-start`: the file Blender runs at every start, which presses the add-on's
// "Connect to Claude" for the user. The check compares the whole text, so an older version is
// written again.

const MODULE_NAME = /^[A-Za-z_]\w*$/;

/** The script, for the add-on `module`. Blender reads Python with `\n` endings. */
export function blenderStartupScript(module: string) {
  if (!MODULE_NAME.test(module)) throw new Error('INVALID_MODULE_NAME');
  return [
    '# Written by AccountSwitch. Blender runs every file in this folder when it starts.',
    '# This one starts the blender-mcp connection ("Connect to Claude"), so Claude Code and',
    '# Codex reach Blender without a click. Delete this file to turn it off.',
    'import bpy',
    '',
    `ADDON = "${module}"`,
    '',
    '',
    'def _start():',
    '    if ADDON not in bpy.context.preferences.addons:',
    '        return None',
    '    if getattr(bpy.types, "blendermcp_server", None):',
    '        return None',
    '    try:',
    '        bpy.ops.blendermcp.start_server()',
    '    except Exception as error:',
    '        print("AccountSwitch: blender-mcp did not start:", error)',
    '    return None',
    '',
    '',
    'def register():',
    '    if not bpy.app.background:',
    '        bpy.app.timers.register(_start, first_interval=1.0)',
    '',
    '',
    'def unregister():',
    '    if bpy.app.timers.is_registered(_start):',
    '        bpy.app.timers.unregister(_start)',
    '',
  ].join('\n');
}

/** Whether a file holds the current script (any line endings). */
export function hasBlenderStartupScript(file: string, module: string) {
  return file.replace(/\r\n/g, '\n') === blenderStartupScript(module);
}

import AppKit

// A menu bar app (LSUIElement): no Dock icon until the window is shown.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

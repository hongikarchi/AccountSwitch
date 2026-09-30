import AppKit
import ServiceManagement

/// Menu bar icon, app server, window and settings for one running AccountSwitch.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private let engine = Engine()
    private var shell: ShellWindow!
    private var settings = Settings.load()
    private var restarts = 0
    private var quitting = false
    private let loginItem = NSMenuItem(title: "로그인 시 실행", action: #selector(toggleLoginItem), keyEquivalent: "")
    private let backgroundItem = NSMenuItem(
        title: "창을 닫아도 메뉴 막대에 남기", action: #selector(toggleBackground), keyEquivalent: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = mainMenu()
        shell = ShellWindow()
        shell.shouldHide = { [unowned self] in self.settings.background && !self.quitting }
        shell.hidden = { [unowned self] in self.hintMenuBar() }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let image = NSImage(systemSymbolName: "arrow.left.arrow.right", accessibilityDescription: "AccountSwitch")
        image?.isTemplate = true
        statusItem.button?.image = image
        statusItem.button?.toolTip = "AccountSwitch"
        let menu = NSMenu()
        menu.delegate = self
        let open = NSMenuItem(title: "AccountSwitch 열기", action: #selector(showWindow), keyEquivalent: "")
        open.attributedTitle = NSAttributedString(
            string: open.title, attributes: [.font: NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)])
        menu.addItem(open)
        menu.addItem(.separator())
        menu.addItem(loginItem)
        menu.addItem(backgroundItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(
            title: "원래 로그인으로 되돌리기…", action: #selector(restoreDefaultLogin), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "종료", action: #selector(quit), keyEquivalent: "q"))
        for item in menu.items { item.target = self }
        statusItem.menu = menu

        engine.exited = { [unowned self] code in self.engineExited(code) }
        // Opened at login: stay in the menu bar; opened by the user: show the window.
        let atLogin = (NSAppleEventManager.shared().currentAppleEvent?.paramDescriptor(
            forKeyword: keyAELaunchedAsLogInItem))?.booleanValue ?? false
        if !atLogin { shell.show() }
        startEngine()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        showWindow()
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if !engine.attached { engine.stop() }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        backgroundItem.state = settings.background ? .on : .off
    }

    private func startEngine() {
        engine.start { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let url): self.shell.open(url)
            case .failure(let error):
                self.shell.showProblem("AccountSwitch 서버를 시작하지 못했습니다: \(error.message)")
                self.shell.show()
            }
        }
    }

    private func engineExited(_ code: Int32) {
        guard !quitting else { return }
        // Restart a crashed server a few times; accounts and settings are on disk.
        restarts += 1
        if restarts <= 3 {
            shell.showProblem("AccountSwitch 서버가 종료되어 다시 시작하는 중입니다…")
            startEngine()
        } else {
            shell.showProblem("AccountSwitch 서버가 계속 종료됩니다 (코드 \(code)). 프로그램을 다시 실행하세요.")
            shell.show()
        }
    }

    @objc private func showWindow() {
        shell.show()
        if let url = engine.url { shell.open(url) }
    }

    @objc private func toggleLoginItem() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            alert("로그인 시 실행을 바꾸지 못했습니다.", error.localizedDescription)
        }
    }

    @objc private func toggleBackground() {
        settings.background.toggle()
        settings.save()
    }

    /// No uninstaller on macOS: this gives the CLIs their original logins back before the app is
    /// moved to the Trash. The server is stopped meanwhile so it does not keep a stale choice.
    @objc private func restoreDefaultLogin() {
        NSApp.activate(ignoringOtherApps: true)
        let confirm = NSAlert()
        confirm.messageText = "원래 로그인으로 되돌릴까요?"
        confirm.informativeText = "다른 계정을 사용 중인 서비스를 \"기존 CLI 로그인\"으로 되돌립니다. 추가한 계정은 그대로 남습니다. 앱을 지우기 전에 누르세요."
        confirm.addButton(withTitle: "되돌리기")
        confirm.addButton(withTitle: "취소")
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        let wasAttached = engine.attached
        if !wasAttached { engine.stop() }
        let result = Engine.restoreDefaultLogin()
        if !wasAttached { startEngine() }
        if result.ok {
            alert("되돌렸습니다.", result.output.contains("restored: none") ? "되돌릴 로그인이 없었습니다." : "")
        } else {
            alert("되돌리지 못했습니다.", result.output)
        }
    }

    @objc private func quit() {
        quitting = true
        NSApp.terminate(nil)
    }

    private func hintMenuBar() {
        guard !settings.menuBarHintShown else { return }
        settings.menuBarHintShown = true
        settings.save()
        alert("메뉴 막대에서 계속 실행됩니다", "창을 닫아도 AccountSwitch는 메뉴 막대 아이콘으로 남습니다. 끝내려면 아이콘 메뉴의 종료를 누르세요.")
    }

    private func alert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        alert.runModal()
    }

    /// Standard menus, so ⌘C/⌘V/⌘A work in the page and ⌘W/⌘Q do what they should.
    private func mainMenu() -> NSMenu {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "AccountSwitch 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        let quitItem = NSMenuItem(title: "AccountSwitch 종료", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        appMenu.addItem(quitItem)
        appItem.submenu = appMenu
        main.addItem(appItem)

        let editItem = NSMenuItem()
        let edit = NSMenu(title: "편집")
        edit.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "실행 복귀", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "오려두기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "복사하기", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let window = NSMenu(title: "윈도우")
        window.addItem(withTitle: "닫기", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        window.addItem(withTitle: "최소화", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = window
        main.addItem(windowItem)
        return main
    }
}

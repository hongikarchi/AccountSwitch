import AppKit
import WebKit

/// The program window: the AccountSwitch page in a WKWebView, without browser chrome.
final class ShellWindow: NSObject, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate {
    let window: NSWindow
    private let view: WKWebView
    private let problem = NSTextField(labelWithString: "AccountSwitch를 시작하는 중…")
    private var origin: String?
    private var opened: URL?
    /// Asked when the window is closed: true keeps the program running in the menu bar.
    var shouldHide: () -> Bool = { true }
    var hidden: () -> Void = {}

    override init() {
        let configuration = WKWebViewConfiguration()
        view = WKWebView(frame: .zero, configuration: configuration)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let size = NSSize(width: min(760, screen.width - 80), height: min(960, screen.height - 80))
        window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()
        window.title = "AccountSwitch"
        window.minSize = NSSize(width: 480, height: 560)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.setFrameAutosaveName("AccountSwitchWindow")
        if !window.setFrameUsingName("AccountSwitchWindow") { window.center() }

        view.navigationDelegate = self
        view.uiDelegate = self
        view.isHidden = true
        problem.alignment = .center
        problem.textColor = .secondaryLabelColor
        problem.font = .systemFont(ofSize: 13)

        let content = NSView()
        for child in [view, problem] as [NSView] {
            child.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(child)
        }
        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            view.topAnchor.constraint(equalTo: content.topAnchor),
            view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            problem.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            problem.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            problem.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor, constant: -40),
        ])
        window.contentView = content
    }

    /// Show the window in front, with a Dock icon while it is open.
    func show() {
        NSApp.setActivationPolicy(.regular)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Show the page (first time: the launch link that signs the window in).
    func open(_ url: URL) {
        origin = "http://\(url.host ?? "127.0.0.1"):\(url.port ?? 80)"
        problem.isHidden = true
        view.isHidden = false
        // After the first sign-in the session cookie is enough; keep the current page.
        if let current = view.url, current.absoluteString.hasPrefix(origin! + "/"), opened != nil { return }
        opened = url
        view.load(URLRequest(url: url))
    }

    func showProblem(_ text: String) {
        problem.stringValue = text
        problem.isHidden = false
        view.isHidden = true
    }

    // Only the local page shows here; other pages (sign-in addresses) open in the default browser.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if let origin, url.absoluteString == origin || url.absoluteString.hasPrefix(origin + "/") {
            return decisionHandler(.allow)
        }
        if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url, url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard shouldHide() else { return true }
        window.orderOut(nil)
        NSApp.setActivationPolicy(.accessory)
        hidden()
        return false
    }
}

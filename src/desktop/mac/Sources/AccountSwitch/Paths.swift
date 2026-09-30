import Foundation

enum Paths {
    /// User data, the same folder the app server uses. After an account switch it holds the
    /// user's original CLI login, so nothing here ever deletes it.
    static let data: URL = {
        if let custom = ProcessInfo.processInfo.environment["ACCOUNTSWITCH_DATA"], !custom.isEmpty {
            return URL(fileURLWithPath: custom)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/AccountSwitch")
    }()

    /// The app server next to this program (Contents/MacOS), or ACCOUNTSWITCH_ENGINE in development.
    static var engine: URL {
        if let custom = ProcessInfo.processInfo.environment["ACCOUNTSWITCH_ENGINE"], !custom.isEmpty {
            return URL(fileURLWithPath: custom)
        }
        return Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/AccountSwitch-engine")
    }

    static var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }
}

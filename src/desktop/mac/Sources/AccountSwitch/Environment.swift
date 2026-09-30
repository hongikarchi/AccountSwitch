import Foundation

enum Environment {
    /// The environment for the app server. An app opened from Finder gets only
    /// /usr/bin:/bin:/usr/sbin:/sbin, where Homebrew and npm installs of the CLIs (and the node a
    /// CLI script needs) are missing, so the login shell's PATH is used. USER and HOME stay as they
    /// are: the keychain item Claude Code uses is keyed by the user name.
    static func forEngine() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = loginPath
        env.removeValue(forKey: "NODE_OPTIONS")
        env.removeValue(forKey: "NODE_PATH")
        return env
    }

    static let loginPath: String = {
        let fallback = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = ["-ilc", "printf '\\n%s' \"$PATH\""]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return fallback }
        let deadline = Date().addingTimeInterval(5)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
        if process.isRunning {
            process.terminate()
            return fallback
        }
        let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        // Start-up files may print; the PATH is the last line.
        let path = text.split(separator: "\n").last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        guard path.contains("/") else { return fallback }
        return path + ":" + fallback
    }()
}

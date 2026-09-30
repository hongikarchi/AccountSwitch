import Foundation

/// The app server (Contents/MacOS/AccountSwitch-engine --desktop): a hidden child process that
/// prints its launch address and stops when its standard input closes.
final class Engine {
    private var process: Process?
    private var input: Pipe?
    private var stopping = false
    private(set) var url: URL?
    /// True when another server already used this data folder and we only show it.
    private(set) var attached = false
    /// Called on the main thread when the server ends by itself (exit code).
    var exited: ((Int32) -> Void)?

    /// Start the server; `done` gets its address or an error message, on the main thread.
    func start(_ done: @escaping (Result<URL, EngineError>) -> Void) {
        stopping = false
        attached = false
        let program = Paths.engine
        guard FileManager.default.isExecutableFile(atPath: program.path) else {
            done(.failure(EngineError("서버 파일이 없습니다: \(program.path)")))
            return
        }
        let process = Process()
        process.executableURL = program
        process.arguments = ["--desktop"]
        process.environment = Environment.forEngine()
        let input = Pipe(), output = Pipe(), errors = Pipe()
        process.standardInput = input
        process.standardOutput = output
        process.standardError = errors

        var answered = false
        var buffer = ""
        var lastError = ""
        let answer = { (result: Result<URL, EngineError>) in
            DispatchQueue.main.async {
                guard !answered else { return }
                answered = true
                done(result)
            }
        }
        output.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            buffer += text
            while let newline = buffer.firstIndex(of: "\n") {
                let line = String(buffer[..<newline]).trimmingCharacters(in: .whitespaces)
                buffer = String(buffer[buffer.index(after: newline)...])
                for (prefix, isAttached) in [("AccountSwitch launch: ", false), ("AccountSwitch attached: ", true)]
                where line.hasPrefix(prefix) {
                    let address = String(line.dropFirst(prefix.count))
                    guard let url = URL(string: address), url.host == "127.0.0.1" else { continue }
                    DispatchQueue.main.async {
                        self.url = url
                        self.attached = isAttached
                    }
                    answer(.success(url))
                }
            }
        }
        errors.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            lastError = text.split(separator: "\n").last.map(String.init) ?? lastError
            Engine.log(text)
        }
        process.terminationHandler = { [weak self] finished in
            output.fileHandleForReading.readabilityHandler = nil
            errors.fileHandleForReading.readabilityHandler = nil
            let code = finished.terminationStatus
            answer(.failure(EngineError(lastError.isEmpty ? "종료 코드 \(code)" : lastError)))
            DispatchQueue.main.async {
                guard let self, self.process === finished else { return }
                self.process = nil
                // A server we only attached to belongs to someone else.
                if !self.stopping && !self.attached { self.exited?(code) }
            }
        }
        do {
            try process.run()
        } catch {
            done(.failure(EngineError(error.localizedDescription)))
            return
        }
        self.process = process
        self.input = input
    }

    /// Close the server's input so it ends its sign-in processes cleanly; kill it after 15 s.
    func stop() {
        stopping = true
        guard let process, process.isRunning else { return }
        try? input?.fileHandleForWriting.close()
        let deadline = Date().addingTimeInterval(15)
        while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
        if process.isRunning { process.terminate() }
        self.process = nil
    }

    /// Put each service's original login back (the server must not be running).
    static func restoreDefaultLogin() -> (ok: Bool, output: String) {
        let process = Process()
        process.executableURL = Paths.engine
        process.arguments = ["--restore-default-login"]
        process.environment = Environment.forEngine()
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        do { try process.run() } catch { return (false, error.localizedDescription) }
        process.waitUntilExit()
        let text = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return (process.terminationStatus == 0, text)
    }

    /// The server's error output (crash traces) goes to logs/engine-stderr-YYYY-MM-DD.log.
    private static func log(_ text: String) {
        let folder = Paths.data.appendingPathComponent("logs")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        let file = folder.appendingPathComponent("engine-stderr-\(day).log")
        let line = Data((ISO8601DateFormatter().string(from: Date()) + " " + text).utf8)
        if let handle = try? FileHandle(forWritingTo: file) {
            handle.seekToEndOfFile()
            handle.write(line)
            try? handle.close()
        } else {
            try? line.write(to: file)
        }
    }
}

struct EngineError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

import Foundation

/// desktop.json in the user data folder (the login item itself is kept by macOS).
struct Settings: Codable {
    /// Closing the window keeps the program in the menu bar.
    var background = true
    var menuBarHintShown = false
    var window: [Double]?

    private static var file: URL { Paths.data.appendingPathComponent("desktop.json") }

    static func load() -> Settings {
        guard let data = try? Data(contentsOf: file),
              let value = try? JSONDecoder().decode(Settings.self, from: data)
        else { return Settings() }
        return value
    }

    func save() {
        try? FileManager.default.createDirectory(at: Paths.data, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(self) {
            try? data.write(to: Settings.file, options: .atomic)
        }
    }
}

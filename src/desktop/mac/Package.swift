// swift-tools-version:5.9
// AccountSwitch for macOS: a menu bar app showing the app server's page in its own window.
import PackageDescription

let package = Package(
    name: "AccountSwitch",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "AccountSwitch", path: "Sources/AccountSwitch")
    ]
)

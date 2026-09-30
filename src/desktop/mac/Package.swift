// swift-tools-version:5.9
// AccountSwitch for macOS: a menu bar app showing the app server's page in its own window.
import PackageDescription

let package = Package(
    name: "AccountSwitch",
    platforms: [.macOS(.v13)],
    dependencies: [
        // 2.10 or later: updates an app signed ad hoc (no Apple developer ID) on EdDSA alone.
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.10.0")
    ],
    targets: [
        .executableTarget(
            name: "AccountSwitch",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/AccountSwitch",
            // Sparkle.framework is copied into Contents/Frameworks by scripts/build-mac.mjs.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"])]
        )
    ]
)

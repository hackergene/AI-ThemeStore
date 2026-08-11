// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "AIThemeStore",
  platforms: [.macOS(.v13)],
  products: [
    .executable(
      name: "ai-themestore",
      targets: ["AIThemeStore"]
    ),
  ],
  targets: [
    .executableTarget(
      name: "AIThemeStore",
      path: "Sources/AIThemeStore"
    ),
  ]
)

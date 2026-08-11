// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "AIThemeStoreCommunity",
  platforms: [.macOS(.v13)],
  products: [
    .executable(
      name: "ai-themestore-community",
      targets: ["AIThemeStoreCommunity"]
    ),
  ],
  targets: [
    .executableTarget(
      name: "AIThemeStoreCommunity",
      path: "Sources/AIThemeStoreCommunity"
    ),
  ]
)

import Foundation

struct BridgeClient: Sendable {
  func status() async throws -> RuntimeStatus {
    try await run(action: "status")
  }

  func apply(themeID: String) async throws -> RuntimeStatus {
    guard ThemeLibrary.isSafeThemeID(themeID) else {
      throw ThemeStoreError.invalidTheme("主题 ID 不安全。")
    }
    return try await run(action: "apply", themeID: themeID)
  }

  func restore() async throws -> RuntimeStatus {
    try await run(action: "restore-native")
  }

  func doctor() async throws -> RuntimeStatus {
    try await run(action: "doctor")
  }

  private func executableURL() -> URL? {
    if let resources = Bundle.main.resourceURL {
      let bundled = resources
        .appendingPathComponent("engine", isDirectory: true)
        .appendingPathComponent("scripts", isDirectory: true)
        .appendingPathComponent("app-bridge-macos.sh", isDirectory: false)
      if FileManager.default.isExecutableFile(atPath: bundled.path) {
        return bundled
      }
    }
    if let root = ProcessInfo.processInfo.environment["THEMESTORE_PROJECT_ROOT"] {
      let development = URL(fileURLWithPath: root, isDirectory: true)
        .appendingPathComponent("engine/scripts/app-bridge-macos.sh", isDirectory: false)
      if FileManager.default.isExecutableFile(atPath: development.path) {
        return development
      }
    }
    return nil
  }

  private func run(action: String, themeID: String? = nil) async throws -> RuntimeStatus {
    guard let executable = executableURL() else { throw ThemeStoreError.bridgeUnavailable }
    let arguments = [action, themeID ?? "", "codex"]
    let home = FileManager.default.homeDirectoryForCurrentUser.path

    return try await Task.detached(priority: .userInitiated) {
      let process = Process()
      let output = Pipe()
      let errors = Pipe()
      process.executableURL = executable
      process.arguments = arguments
      process.environment = [
        "HOME": home,
        "LANG": "en_US.UTF-8",
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "THEMESTORE_NOTIFICATION_OWNER": "native-app",
      ]
      process.standardOutput = output
      process.standardError = errors
      try process.run()
      process.waitUntilExit()
      let outputData = output.fileHandleForReading.readDataToEndOfFile()
      let errorData = errors.fileHandleForReading.readDataToEndOfFile()
      guard process.terminationStatus == 0 else {
        let message = String(data: errorData, encoding: .utf8)?
          .trimmingCharacters(in: .whitespacesAndNewlines)
        throw ThemeStoreError.bridgeFailed(
          message?.isEmpty == false ? message! : "本地主题操作失败。"
        )
      }
      guard let status = try? JSONDecoder().decode(RuntimeStatus.self, from: outputData) else {
        throw ThemeStoreError.invalidBridgeResponse
      }
      return status
    }.value
  }
}

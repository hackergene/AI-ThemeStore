import AppKit
import Foundation

@MainActor
final class AppModel: ObservableObject {
  @Published private(set) var themes: [ThemeModel] = []
  @Published private(set) var runtime = RuntimeStatus.unavailable
  @Published private(set) var busy = false
  @Published private(set) var activity = "正在读取本地主题…"
  @Published var alertMessage = ""

  private let bridge = BridgeClient()
  private var bootstrapped = false

  var activeThemeID: String? {
    runtime.runtimeVerified == true ? runtime.desiredThemeId : nil
  }

  var runtimeLabel: String {
    if busy { return activity }
    if runtime.runtimeVerified == true {
      return "主题运行中"
    }
    if runtime.status == "safe_mode" {
      return "安全模式"
    }
    return "官方外观"
  }

  func bootstrap() async {
    guard !bootstrapped else { return }
    bootstrapped = true
    do {
      try ThemeLibrary.installBundledThemes()
      themes = try ThemeLibrary.scan()
      runtime = (try? await bridge.status()) ?? .unavailable
      activity = "准备就绪"
    } catch {
      show(error)
    }
  }

  func refresh() async {
    guard !busy else { return }
    busy = true
    activity = "正在刷新…"
    defer { busy = false }
    do {
      themes = try ThemeLibrary.scan()
      runtime = try await bridge.status()
      activity = "已刷新"
    } catch {
      show(error)
    }
  }

  func apply(_ theme: ThemeModel) async {
    guard !busy else { return }
    busy = true
    activity = "正在应用 \(theme.name)…"
    defer { busy = false }
    do {
      runtime = try await bridge.apply(themeID: theme.id)
      activity = "\(theme.name) 已通过实时验证"
    } catch {
      show(error)
    }
  }

  func restore() async {
    guard !busy else { return }
    busy = true
    activity = "正在恢复官方外观…"
    defer { busy = false }
    do {
      runtime = try await bridge.restore()
      activity = "已恢复 Codex 官方外观"
    } catch {
      show(error)
    }
  }

  func verify() async {
    guard !busy else { return }
    busy = true
    activity = "正在执行本地诊断…"
    defer { busy = false }
    do {
      runtime = try await bridge.doctor()
      activity = "本地诊断已完成"
    } catch {
      show(error)
    }
  }

  func openThemesFolder() {
    do {
      NSWorkspace.shared.open(try ThemeLibrary.themesRoot())
    } catch {
      show(error)
    }
  }

  private func show(_ error: Error) {
    alertMessage = error.localizedDescription
    activity = "操作未完成"
  }
}

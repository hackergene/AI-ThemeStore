import SwiftUI

@main
struct AIThemeStoreApp: App {
  @StateObject private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environmentObject(model)
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1040, height: 760)
  }
}

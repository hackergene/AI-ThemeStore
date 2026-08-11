import AppKit
import SwiftUI

struct ContentView: View {
  @EnvironmentObject private var model: AppModel

  private let columns = [
    GridItem(.flexible(), spacing: 20),
    GridItem(.flexible(), spacing: 20),
    GridItem(.flexible(), spacing: 20),
  ]

  var body: some View {
    ZStack {
      LinearGradient(
        colors: [Color(red: 0.07, green: 0.08, blue: 0.12), Color(red: 0.13, green: 0.08, blue: 0.16)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
      .ignoresSafeArea()

      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          header
          themeGrid
          controls
          footer
        }
        .padding(32)
      }
    }
    .frame(minWidth: 940, minHeight: 680)
    .task { await model.bootstrap() }
    .alert(
      "AI ThemeStore",
      isPresented: Binding(
        get: { !model.alertMessage.isEmpty },
        set: { if !$0 { model.alertMessage = "" } }
      )
    ) {
      Button("知道了", role: .cancel) { model.alertMessage = "" }
    } message: {
      Text(model.alertMessage)
    }
  }

  private var header: some View {
    HStack(alignment: .top, spacing: 20) {
      VStack(alignment: .leading, spacing: 8) {
        Text("AI ThemeStore")
          .font(.system(size: 34, weight: .bold, design: .rounded))
        Text("OPEN SOURCE · OFFLINE MAC APP")
          .font(.system(size: 12, weight: .semibold, design: .monospaced))
          .foregroundStyle(.secondary)
        Text("选择一套本地主题，为 Codex 换一张会呼吸的脸。")
          .font(.title3)
          .foregroundStyle(.secondary)
      }
      Spacer()
      HStack(spacing: 8) {
        Circle()
          .fill(model.runtime.runtimeVerified == true ? Color.green : Color.secondary)
          .frame(width: 8, height: 8)
        Text(model.runtimeLabel)
          .font(.system(size: 13, weight: .semibold))
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 9)
      .background(.ultraThinMaterial, in: Capsule())
    }
    .foregroundStyle(.white)
  }

  private var themeGrid: some View {
    LazyVGrid(columns: columns, spacing: 20) {
      ForEach(model.themes) { theme in
        ThemeCard(
          theme: theme,
          active: model.activeThemeID == theme.id,
          disabled: model.busy,
          apply: { Task { await model.apply(theme) } }
        )
      }
    }
  }

  private var controls: some View {
    HStack(spacing: 12) {
      Button {
        model.openThemesFolder()
      } label: {
        Label("打开主题目录", systemImage: "folder")
      }

      Button {
        Task { await model.refresh() }
      } label: {
        Label("刷新", systemImage: "arrow.clockwise")
      }

      Spacer()

      Button {
        Task { await model.verify() }
      } label: {
        Label("本地诊断", systemImage: "checkmark.shield")
      }

      Button(role: .destructive) {
        Task { await model.restore() }
      } label: {
        Label("恢复官方外观", systemImage: "arrow.uturn.backward.circle")
      }
      .disabled(model.busy)
    }
    .buttonStyle(.bordered)
    .controlSize(.large)
    .foregroundStyle(.white)
  }

  private var footer: some View {
    HStack(spacing: 10) {
      if model.busy {
        ProgressView()
          .controlSize(.small)
      }
      Text(model.activity)
      Spacer()
      Text("仅使用本机回环连接 · 不修改官方 App")
    }
    .font(.footnote)
    .foregroundStyle(.secondary)
  }
}

private struct ThemeCard: View {
  let theme: ThemeModel
  let active: Bool
  let disabled: Bool
  let apply: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      preview
        .frame(height: 150)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .topTrailing) {
          if active {
            Label("使用中", systemImage: "checkmark.circle.fill")
              .font(.caption.bold())
              .padding(.horizontal, 10)
              .padding(.vertical, 6)
              .background(.thinMaterial, in: Capsule())
              .padding(10)
          }
        }

      Text(theme.name)
        .font(.title3.bold())
      Text(theme.description)
        .font(.callout)
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .frame(minHeight: 38, alignment: .top)

      Button(active ? "重新应用" : "应用主题", action: apply)
        .buttonStyle(.borderedProminent)
        .tint(active ? .green : .accentColor)
        .disabled(disabled)
    }
    .padding(16)
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .stroke(active ? Color.green.opacity(0.8) : Color.white.opacity(0.12), lineWidth: active ? 2 : 1)
    }
    .foregroundStyle(.white)
  }

  @ViewBuilder
  private var preview: some View {
    if let image = NSImage(contentsOf: theme.previewURL) {
      Image(nsImage: image)
        .resizable()
        .scaledToFill()
    } else {
      ZStack {
        Color.white.opacity(0.08)
        Image(systemName: "photo")
      }
    }
  }
}

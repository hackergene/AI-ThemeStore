import Foundation

enum ThemeLibrary {
  static func themesRoot(create: Bool = true) throws -> URL {
    let manager = FileManager.default
    let support = try manager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: create
    )
    let root = support
      .appendingPathComponent("AIThemeStore", isDirectory: true)
      .appendingPathComponent("themes", isDirectory: true)
    if create, !manager.fileExists(atPath: root.path) {
      try manager.createDirectory(at: root, withIntermediateDirectories: true)
    }
    return root
  }

  static func installBundledThemes() throws {
    let manager = FileManager.default
    guard let resourceRoot = Bundle.main.resourceURL else {
      throw CommunityError.invalidTheme("App 资源目录不可用。")
    }
    let bundledRoot = resourceRoot.appendingPathComponent("themes", isDirectory: true)
    let destinationRoot = try themesRoot()
    let sources = try manager.contentsOfDirectory(
      at: bundledRoot,
      includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
      options: [.skipsHiddenFiles]
    )

    for source in sources {
      _ = try readTheme(at: source)
      let destination = destinationRoot.appendingPathComponent(source.lastPathComponent, isDirectory: true)
      if !manager.fileExists(atPath: destination.path) {
        try manager.copyItem(at: source, to: destination)
      }
    }
  }

  static func scan() throws -> [CommunityTheme] {
    let manager = FileManager.default
    let root = try themesRoot()
    let directories = try manager.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey],
      options: [.skipsHiddenFiles]
    )
    return directories.compactMap { try? readTheme(at: $0) }
      .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
  }

  static func readTheme(at directory: URL) throws -> CommunityTheme {
    let values = try directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
      throw CommunityError.invalidTheme("主题目录必须是本地普通目录。")
    }

    let metadataURL = directory.appendingPathComponent("theme.json", isDirectory: false)
    let metadataValues = try metadataURL.resourceValues(
      forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
    )
    guard metadataValues.isRegularFile == true,
          metadataValues.isSymbolicLink != true,
          let size = metadataValues.fileSize,
          size > 0,
          size <= 64 * 1024 else {
      throw CommunityError.invalidTheme("theme.json 缺失或大小不安全。")
    }

    let metadata = try JSONDecoder().decode(ThemeMetadata.self, from: Data(contentsOf: metadataURL))
    guard isSafeThemeID(metadata.id), metadata.id == directory.lastPathComponent else {
      throw CommunityError.invalidTheme("主题 ID 与目录名不一致。")
    }
    guard metadata.name.count <= 80, metadata.version.count <= 32 else {
      throw CommunityError.invalidTheme("主题名称或版本号过长。")
    }
    guard metadata.assets.hero == URL(fileURLWithPath: metadata.assets.hero).lastPathComponent,
          !metadata.assets.hero.contains("/") else {
      throw CommunityError.invalidTheme("主题背景必须位于主题目录内。")
    }

    let previewURL = directory.appendingPathComponent(metadata.assets.hero, isDirectory: false)
    let previewValues = try previewURL.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
    guard previewValues.isRegularFile == true, previewValues.isSymbolicLink != true else {
      throw CommunityError.invalidTheme("主题背景不存在或不是普通文件。")
    }
    return CommunityTheme(
      id: metadata.id,
      metadata: metadata,
      directoryURL: directory,
      previewURL: previewURL
    )
  }

  static func isSafeThemeID(_ value: String) -> Bool {
    value.range(of: #"^[A-Za-z0-9._-]{1,80}$"#, options: .regularExpression) != nil
  }
}

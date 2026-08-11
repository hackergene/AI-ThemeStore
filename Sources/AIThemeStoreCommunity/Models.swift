import Foundation

struct ThemeMetadata: Decodable, Sendable {
  struct Assets: Decodable, Sendable {
    let hero: String
  }

  let id: String
  let name: String
  let version: String
  let author: String
  let description: String
  let assets: Assets
}

struct CommunityTheme: Identifiable, Sendable {
  let id: String
  let metadata: ThemeMetadata
  let directoryURL: URL
  let previewURL: URL

  var name: String { metadata.name }
  var description: String { metadata.description }
}

struct RuntimeStatus: Decodable, Sendable {
  let status: String
  let desiredThemeId: String?
  let hostVersion: String?
  let runtimeVerified: Bool?
  let reasonCode: String?

  static let unavailable = RuntimeStatus(
    status: "unavailable",
    desiredThemeId: "native",
    hostVersion: nil,
    runtimeVerified: false,
    reasonCode: nil
  )
}

enum CommunityError: LocalizedError {
  case invalidTheme(String)
  case bridgeUnavailable
  case bridgeFailed(String)
  case invalidBridgeResponse

  var errorDescription: String? {
    switch self {
    case .invalidTheme(let message): message
    case .bridgeUnavailable: "找不到本地主题引擎，请重新构建 App。"
    case .bridgeFailed(let message): message
    case .invalidBridgeResponse: "主题引擎返回了无法识别的状态。"
    }
  }
}

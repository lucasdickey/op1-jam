// The AI Gateway key, kept in the Mac's Keychain. The Electron app wrote it
// to an encrypted file whose key lived in the Keychain (src/main/key.ts); a
// native app can put the key itself there, as one generic password item,
// and let macOS do the encrypting. macOS may ask once, on first use, whether
// OP-1 Jam may use its own item.
//
// The key only ever lives in this process. The window can ask whether one is
// set and replace it, but never read it back.

import Foundation
import Security

public struct KeychainKeyStore: KeyStoring {
    /// The item's name in Keychain Access, and the account it is filed under.
    public static let service = "OP-1 Jam"
    public static let account = "ai-gateway-key"

    /// Set in the environment, this key is used instead of the Keychain's:
    /// for tests, and for running from the terminal without touching the
    /// Keychain at all.
    public static let environmentKey = "OP1_GATEWAY_KEY"

    public init() {}

    /// The attributes that name the one item this app keeps.
    private var query: [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account,
        ]
    }

    public func load() -> String? {
        if let fromEnvironment = ProcessInfo.processInfo.environment[Self.environmentKey] {
            let key = fromEnvironment.trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty { return key }
        }
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var found: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &found)
        guard status == errSecSuccess, let data = found as? Data,
              let text = String(data: data, encoding: .utf8) else { return nil }
        let key = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? nil : key
    }

    public func save(_ key: String) throws {
        let data = Data(key.utf8)
        // Replace the item if there is one, else add it.
        let change: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(query as CFDictionary, change as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            // Readable once the Mac has been unlocked since starting up,
            // which is when the app can be running anyway.
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecParam {
                // The older, file-based keychain on a Mac can refuse the
                // accessibility setting outright; its items are unlocked with
                // the login keychain, which comes to the same thing.
                add[kSecAttrAccessible as String] = nil
                status = SecItemAdd(add as CFDictionary, nil)
            }
        }
        guard status == errSecSuccess else {
            throw KeychainError(status, "The key couldn't be kept in the Keychain")
        }
    }

    public func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status, "The key couldn't be removed from the Keychain")
        }
    }
}

/// A Keychain refusal, with the system's own words for the status code.
public struct KeychainError: LocalizedError, Equatable {
    public let status: OSStatus
    public let line: String

    public init(_ status: OSStatus, _ doing: String) {
        self.status = status
        let reason = (SecCopyErrorMessageString(status, nil) as String?) ?? "error \(status)"
        self.line = "\(doing): \(reason)."
    }

    public var errorDescription: String? { line }
}

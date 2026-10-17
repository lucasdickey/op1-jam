// Asks Claude for the next loop, through the Vercel AI Gateway. A port of
// src/main/claude.ts: the same model, prompt, effort, token ceiling and one
// retry, over URLSession instead of the AI SDK. The request and the reading
// of the answer are in GatewayRequest.swift; this file is the call itself.

import Foundation
import Op1Core
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct GatewayPatternWriter: PatternWriting {
    private let key: String
    private let model: String
    private let session: URLSession

    /// The key comes from the key store, never the environment. The model
    /// defaults to OP1_MODEL or Opus 5.5, as in the Electron app.
    public init(key: String, model: String = defaultModel(), session: URLSession = .shared) {
        self.key = key
        self.model = model
        self.session = session
    }

    public func writePattern(_ request: PatternRequest) async throws -> PatternResponse {
        let started = DispatchTime.now()
        let urlRequest = try patternRequest(request, key: key, model: model)

        // One retry, as the AI SDK was told to make: a busy gateway or a
        // dropped connection gets a second go after a short wait, anything
        // else (a bad key, a bad request, cancellation) comes straight back.
        var output: PatternOutput
        do {
            output = try await send(urlRequest)
        } catch let error as GatewayError where error.isTransient {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            output = try await send(urlRequest)
        } catch let error as URLError where error.code != .cancelled {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            output = try await send(urlRequest)
        }

        let elapsed = DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds
        return patternResponse(output, for: request, ms: Int(elapsed / 1_000_000))
    }

    /// One attempt. URLSession's async call throws when the Task is
    /// cancelled, which is how "ask again" and "stop" cancel a call in
    /// flight rather than paying for an answer nobody will hear.
    private func send(_ urlRequest: URLRequest) async throws -> PatternOutput {
        let (data, response) = try await session.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw GatewayError(gatewayErrorMessage(data) ?? "The gateway answered \(status).", status: status)
        }
        return try decodePatternOutput(data)
    }
}

/// An error as one line for the status line. The gateway's messages are
/// written for a terminal — colour codes and several paragraphs of advice —
/// so this keeps the first line without the colour.
public func errorLine(_ error: Error) -> String {
    if error is CancellationError { return "Cancelled." }
    if let urlError = error as? URLError, urlError.code == .cancelled { return "Cancelled." }
    let raw = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    let plain = raw.replacingOccurrences(of: "\u{001B}\\[[0-9;]*m", with: "", options: .regularExpression)
    let first = plain.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
    let line = String(first.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
    return line.isEmpty ? "Claude couldn't write a pattern." : line
}

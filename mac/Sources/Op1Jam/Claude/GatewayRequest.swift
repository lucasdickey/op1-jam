// The bytes OP-1 Jam sends the Vercel AI Gateway for a pattern, and how the
// answer is read back. Pure functions on purpose: nothing here touches the
// network, so each can be read on its own and checked against the Electron
// app's call in src/main/claude.ts.
//
// The Electron app lets the AI SDK's generateObject pick the wire format.
// Here the call is the gateway's Anthropic Messages endpoint with a JSON
// schema in `output_config.format`, which is what forces a structured answer
// on Claude Opus 5.5: that model refuses a forced tool call, so the older
// trick of one tool with tool_choice pointing at it would be a 400.

import Foundation
import Op1Core
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Where the gateway takes Anthropic-shaped requests.
public let gatewayMessagesURL = URL(string: "https://ai-gateway.vercel.sh/v1/messages")!

/// The Messages API version the request is written against.
public let anthropicVersion = "2023-06-01"

/// Thinking is charged against this ceiling too; the pattern itself is a
/// few hundred tokens to a couple of thousand for a busy arpeggio.
public let maxOutputTokens = 8000

/// Gateway ids name a provider; a bare Anthropic id gets one.
public func gatewayModel(_ id: String) -> String {
    return id.contains("/") ? id : "anthropic/\(id)"
}

/// Opus at low effort. The call is on the clock — the loop keeps playing
/// while it runs, and the answer lands at the top of whichever loop comes
/// next — so effort is turned down from Opus 5.5's default of medium: a
/// two-bar bassline needs taste more than deliberation. OP1_MODEL swaps the
/// model, e.g. `anthropic/claude-opus-5.5-fast` for quicker answers at twice
/// the price.
public func defaultModel(environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
    let chosen = environment["OP1_MODEL"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return gatewayModel(chosen.isEmpty ? "anthropic/claude-opus-5.5" : chosen)
}

/* --- What Claude sends back ---------------------------------------------- */

/// The shape Claude's answer must take: the Output schema from claude.ts.
/// No ranges in it: a note one step past the loop is a small mistake, and
/// rejecting the whole pattern over it would cost the person a loop of
/// waiting. The ranges are enforced by `tidy` instead. (Structured outputs
/// would not take ranges anyway.)
public let outputSchema: [String: Any] = [
    "type": "object",
    "additionalProperties": false,
    "properties": [
        "notes": [
            "type": "array",
            "description": "Every note in the loop.",
            "items": [
                "type": "object",
                "additionalProperties": false,
                "properties": [
                    "step": [
                        "type": "integer",
                        "description": "Start, in sixteenth-note steps from the top of the loop, 0-based.",
                    ],
                    "note": [
                        "type": "integer",
                        "description": "MIDI note number; 60 is middle C.",
                    ],
                    "length": [
                        "type": "integer",
                        "description": "How many steps the note holds, at least 1.",
                    ],
                ],
                "required": ["step", "note", "length"],
            ],
        ],
        "note": [
            "type": "string",
            "description": "One short sentence to the player, in plain words, about what you wrote or changed.",
        ],
    ],
    "required": ["notes", "note"],
]

/// Claude's answer as it comes back, before `tidy`.
public struct PatternOutput: Decodable, Equatable {
    public var notes: [PatternNote]
    public var note: String

    public init(notes: [PatternNote], note: String) {
        self.notes = notes
        self.note = note
    }
}

/* --- The request ---------------------------------------------------------- */

/// The JSON body for one pattern, as the gateway's Messages endpoint reads it.
public func patternRequestBody(_ req: PatternRequest, model: String) -> [String: Any] {
    return [
        "model": model,
        "max_tokens": maxOutputTokens,
        // The system prompt repeats on every call, a few seconds apart, for
        // as long as the app plays — the case caching is for. Marking it
        // puts Anthropic's cache breakpoint after it, so repeats are read
        // back at a tenth of the price.
        "system": [
            [
                "type": "text",
                "text": systemPrompt,
                "cache_control": ["type": "ephemeral"],
            ],
        ],
        "messages": [
            ["role": "user", "content": describeRequest(req)],
        ],
        "output_config": [
            "effort": "low",
            "format": ["type": "json_schema", "schema": outputSchema],
        ],
    ]
}

/// The same body as bytes, keys sorted so the same request is the same
/// bytes every time.
public func patternRequestData(_ req: PatternRequest, model: String) throws -> Data {
    return try JSONSerialization.data(
        withJSONObject: patternRequestBody(req, model: model),
        options: [.sortedKeys]
    )
}

/// The whole request, headers and all. The key goes in the Authorization
/// header, which is the form the gateway documents for its Messages endpoint.
public func patternRequest(_ req: PatternRequest, key: String, model: String) throws -> URLRequest {
    var request = URLRequest(url: gatewayMessagesURL)
    request.httpMethod = "POST"
    request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(anthropicVersion, forHTTPHeaderField: "anthropic-version")
    request.httpBody = try patternRequestData(req, model: model)
    // The loop keeps playing in the meantime, so a slow answer is better than
    // none; but something has to end a call the network has quietly dropped.
    request.timeoutInterval = 180
    return request
}

/* --- The answer ----------------------------------------------------------- */

/// What went wrong talking to the gateway, worded for the status line.
public struct GatewayError: LocalizedError, Equatable {
    public let message: String
    /// The HTTP status, when there was one.
    public let status: Int?

    public init(_ message: String, status: Int? = nil) {
        self.message = message
        self.status = status
    }

    public var errorDescription: String? { message }

    /// Whether another go might land: the gateway was busy or fell over,
    /// not that the request itself was wrong.
    public var isTransient: Bool {
        guard let status = status else { return false }
        return status == 408 || status == 409 || status == 429 || status >= 500
    }
}

// The pieces of a Messages response that matter here. Everything else
// (ids, usage, thinking blocks) is left to the decoder to skip.
private struct MessageEnvelope: Decodable {
    struct Block: Decodable {
        var type: String
        var text: String?
    }
    struct ErrorBody: Decodable {
        var type: String?
        var message: String?
    }
    var type: String?
    var content: [Block]?
    var stopReason: String?
    var error: ErrorBody?

    enum CodingKeys: String, CodingKey {
        case type, content, error
        case stopReason = "stop_reason"
    }
}

/// The one line the gateway's error body carries, when the body is one.
public func gatewayErrorMessage(_ data: Data) -> String? {
    guard let envelope = try? JSONDecoder().decode(MessageEnvelope.self, from: data) else { return nil }
    let message = envelope.error?.message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return message.isEmpty ? nil : message
}

/// Claude's answer out of a 200 response: the JSON in the text block,
/// decoded against the Output schema.
public func decodePatternOutput(_ data: Data) throws -> PatternOutput {
    let envelope: MessageEnvelope
    do {
        envelope = try JSONDecoder().decode(MessageEnvelope.self, from: data)
    } catch {
        throw GatewayError("The gateway's answer wasn't a message.")
    }
    if envelope.type == "error" {
        throw GatewayError(envelope.error?.message ?? "The gateway reported an error.")
    }
    switch envelope.stopReason {
    case "max_tokens":
        throw GatewayError("Claude ran out of room before finishing the pattern.")
    case "refusal":
        throw GatewayError("Claude declined to write that one.")
    default:
        break
    }
    guard let text = envelope.content?.first(where: { $0.type == "text" })?.text else {
        throw GatewayError("Claude's answer had no pattern in it.")
    }
    do {
        return try JSONDecoder().decode(PatternOutput.self, from: Data(text.utf8))
    } catch {
        throw GatewayError("Claude's answer wasn't a pattern.")
    }
}

/// From Claude's answer to the loop the player gets: inside the loop, note
/// trimmed to one line's worth. `ms` is the caller's, measured around the
/// whole call.
public func patternResponse(_ output: PatternOutput, for req: PatternRequest, ms: Int) -> PatternResponse {
    let note = output.note.trimmingCharacters(in: .whitespacesAndNewlines)
    return PatternResponse(pattern: tidy(output.notes, req), note: String(note.prefix(300)), ms: ms)
}

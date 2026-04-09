import Foundation

// MARK: - Intent Parser

/// Parses user speech transcriptions into structured intents using on-device Gemma 4.
/// Classifies into note categories and system commands with extracted entities.
final class IntentParser {

    // MARK: - Singleton

    static let shared = IntentParser()

    // MARK: - Prompt Template

    private let systemPrompt = """
    You are an intent parser for a mobile AI assistant. Given the user's spoken text, analyze and output ONLY valid JSON with these fields:

    {
      "category": "note|task|reminder|action|contact|idea|query",
      "command": "flashlight_on|flashlight_off|set_reminder|create_event|read_calendar|make_call|toggle_dnd|take_photo|set_brightness|set_volume|open_url|search_contacts|none",
      "entities": {
        "contact_name": null,
        "date_time": null,
        "reminder_text": null,
        "event_title": null,
        "url": null,
        "brightness_level": null,
        "volume_level": null,
        "note_content": null,
        "search_query": null
      },
      "confidence": 0.0
    }

    RULES:
    - "category" classifies the overall intent type
    - "command" maps to a specific iOS system action, or "none" if not a system command
    - Extract ALL relevant entities from the text
    - "confidence" is 0.0 to 1.0 indicating how certain you are
    - For tasks/reminders, extract the date/time if mentioned
    - For calls, extract the contact name
    - For notes/ideas, put the core content in "note_content"
    - For queries, put the question in "search_query"
    - Output ONLY the JSON object, nothing else
    """

    // MARK: - Parse

    /// Parse a transcribed voice input into a structured intent
    func parse(transcription: String) async -> ParsedIntent {
        // Try LLM-based parsing first
        if LLMService.shared.isLoaded {
            if let intent = await parseLLM(transcription: transcription) {
                return intent
            }
        }

        // Fallback to rule-based parsing
        return parseRuleBased(transcription: transcription)
    }

    // MARK: - LLM-Based Parsing

    private func parseLLM(transcription: String) async -> ParsedIntent? {
        let prompt = LLMService.shared.formatPrompt(
            system: systemPrompt,
            user: transcription
        )

        let response = await LLMService.shared.generateSync(
            prompt: prompt,
            maxTokens: 256,
            temperature: 0.1  // Low temperature for deterministic parsing
        )

        return parseJSONResponse(response)
    }

    /// Extract and parse JSON from LLM response (handles markdown code fences)
    private func parseJSONResponse(_ response: String) -> ParsedIntent? {
        // Strip markdown code fences if present
        var jsonString = response.trimmingCharacters(in: .whitespacesAndNewlines)

        if jsonString.hasPrefix("```json") {
            jsonString = String(jsonString.dropFirst(7))
        } else if jsonString.hasPrefix("```") {
            jsonString = String(jsonString.dropFirst(3))
        }

        if jsonString.hasSuffix("```") {
            jsonString = String(jsonString.dropLast(3))
        }

        jsonString = jsonString.trimmingCharacters(in: .whitespacesAndNewlines)

        // Try to extract JSON object from the response
        if let startIdx = jsonString.firstIndex(of: "{"),
           let endIdx = jsonString.lastIndex(of: "}") {
            jsonString = String(jsonString[startIdx...endIdx])
        }

        guard let data = jsonString.data(using: .utf8) else { return nil }

        do {
            let raw = try JSONDecoder().decode(RawParsedIntent.self, from: data)
            return raw.toIntent()
        } catch {
            print("[IntentParser] JSON parse error: \(error)")
            return nil
        }
    }

    // MARK: - Rule-Based Fallback

    /// Simple keyword-based intent classification when LLM is unavailable
    private func parseRuleBased(transcription: String) -> ParsedIntent {
        let lower = transcription.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // System commands
        if lower.contains("flashlight on") || lower.contains("turn on the flashlight") || lower.contains("turn on flashlight") {
            return makeIntent(category: .note, command: .flashlightOn, confidence: 0.9)
        }
        if lower.contains("flashlight off") || lower.contains("turn off the flashlight") || lower.contains("turn off flashlight") {
            return makeIntent(category: .note, command: .flashlightOff, confidence: 0.9)
        }
        if lower.contains("remind me") || lower.contains("set a reminder") || lower.contains("set reminder") {
            return makeIntent(
                category: .reminder,
                command: .setReminder,
                confidence: 0.85,
                entities: .init(reminderText: transcription)
            )
        }
        if lower.contains("create event") || lower.contains("add to calendar") || lower.contains("schedule") {
            return makeIntent(
                category: .task,
                command: .createEvent,
                confidence: 0.8,
                entities: .init(eventTitle: transcription)
            )
        }
        if lower.contains("what's on my calendar") || lower.contains("read my calendar") || lower.contains("what do i have today") {
            return makeIntent(category: .query, command: .readCalendar, confidence: 0.85)
        }
        if lower.contains("call ") {
            let contactName = extractAfterKeyword(lower, keyword: "call")
            return makeIntent(
                category: .contact,
                command: .makeCall,
                confidence: 0.85,
                entities: .init(contactName: contactName)
            )
        }
        if lower.contains("do not disturb") || lower.contains("dnd") || lower.contains("turn off notifications") {
            return makeIntent(category: .note, command: .toggleDND, confidence: 0.85)
        }
        if lower.contains("take a photo") || lower.contains("take photo") || lower.contains("open camera") {
            return makeIntent(category: .note, command: .takePhoto, confidence: 0.9)
        }
        if lower.contains("brightness") {
            return makeIntent(category: .note, command: .setBrightness, confidence: 0.7)
        }
        if lower.contains("volume") {
            return makeIntent(category: .note, command: .setVolume, confidence: 0.7)
        }

        // Intent categories (non-system-command)
        if lower.contains("send email") || lower.contains("email") || lower.contains("send message") || lower.contains("slack") {
            return makeIntent(
                category: .action,
                command: .none,
                confidence: 0.7,
                entities: .init(noteContent: transcription)
            )
        }
        if lower.contains("idea") || lower.contains("what if") || lower.contains("i think") {
            return makeIntent(
                category: .idea,
                command: .none,
                confidence: 0.6,
                entities: .init(noteContent: transcription)
            )
        }
        if lower.hasPrefix("what") || lower.hasPrefix("how") || lower.hasPrefix("who") || lower.hasPrefix("when") || lower.hasPrefix("where") || lower.hasPrefix("why") || lower.contains("?") {
            return makeIntent(
                category: .query,
                command: .none,
                confidence: 0.6,
                entities: .init(searchQuery: transcription)
            )
        }
        if lower.contains("task") || lower.contains("to do") || lower.contains("todo") || lower.contains("need to") {
            return makeIntent(
                category: .task,
                command: .none,
                confidence: 0.6,
                entities: .init(noteContent: transcription)
            )
        }

        // Default: treat as a general note
        return makeIntent(
            category: .note,
            command: .none,
            confidence: 0.5,
            entities: .init(noteContent: transcription)
        )
    }

    // MARK: - Helpers

    private func makeIntent(
        category: NoteCategory,
        command: SystemCommand,
        confidence: Double,
        entities: ParsedIntent.IntentEntities = .init()
    ) -> ParsedIntent {
        ParsedIntent(
            category: category,
            command: command,
            entities: entities,
            confidence: confidence
        )
    }

    private func extractAfterKeyword(_ text: String, keyword: String) -> String? {
        guard let range = text.range(of: keyword) else { return nil }
        let after = text[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return after.isEmpty ? nil : after
    }
}

// MARK: - Raw JSON Model (for flexible LLM output parsing)

private struct RawParsedIntent: Codable {
    let category: String?
    let command: String?
    let entities: RawEntities?
    let confidence: Double?

    struct RawEntities: Codable {
        let contact_name: String?
        let date_time: String?
        let reminder_text: String?
        let event_title: String?
        let url: String?
        let brightness_level: Double?
        let volume_level: Double?
        let note_content: String?
        let search_query: String?
    }

    func toIntent() -> ParsedIntent {
        let cat = NoteCategory(rawValue: category ?? "note") ?? .note
        let cmd = commandFromString(command ?? "none")
        let ent = ParsedIntent.IntentEntities(
            contactName: entities?.contact_name,
            dateTime: entities?.date_time,
            reminderText: entities?.reminder_text,
            eventTitle: entities?.event_title,
            url: entities?.url,
            brightnessLevel: entities?.brightness_level,
            volumeLevel: entities?.volume_level,
            noteContent: entities?.note_content,
            searchQuery: entities?.search_query
        )

        return ParsedIntent(
            category: cat,
            command: cmd,
            entities: ent,
            confidence: confidence ?? 0.5
        )
    }

    private func commandFromString(_ str: String) -> SystemCommand {
        let mapping: [String: SystemCommand] = [
            "flashlight_on": .flashlightOn,
            "flashlight_off": .flashlightOff,
            "set_reminder": .setReminder,
            "create_event": .createEvent,
            "read_calendar": .readCalendar,
            "make_call": .makeCall,
            "toggle_dnd": .toggleDND,
            "take_photo": .takePhoto,
            "set_brightness": .setBrightness,
            "set_volume": .setVolume,
            "open_url": .openURL,
            "search_contacts": .searchContacts,
            "none": .none,
        ]
        return mapping[str] ?? .none
    }
}

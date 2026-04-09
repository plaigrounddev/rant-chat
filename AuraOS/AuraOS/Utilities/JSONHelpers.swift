import Foundation

// MARK: - JSON Helpers

/// Utilities for safe JSON extraction from LLM responses.
/// Handles common issues like markdown code fences, extra text, and malformed JSON.
enum JSONHelpers {

    /// Extract a JSON object from a string that might contain markdown fences and extra text
    static func extractJSON(from text: String) -> String? {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)

        // Remove markdown code fences
        if cleaned.hasPrefix("```json") {
            cleaned = String(cleaned.dropFirst(7))
        } else if cleaned.hasPrefix("```") {
            cleaned = String(cleaned.dropFirst(3))
        }

        if cleaned.hasSuffix("```") {
            cleaned = String(cleaned.dropLast(3))
        }

        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)

        // Find the first { and last } for object extraction
        guard let startIdx = cleaned.firstIndex(of: "{"),
              let endIdx = cleaned.lastIndex(of: "}") else {
            // Try array extraction
            if let arrStart = cleaned.firstIndex(of: "["),
               let arrEnd = cleaned.lastIndex(of: "]") {
                return String(cleaned[arrStart...arrEnd])
            }
            return nil
        }

        return String(cleaned[startIdx...endIdx])
    }

    /// Safely decode JSON from an LLM response
    static func decode<T: Decodable>(_ type: T.Type, from response: String) -> T? {
        guard let jsonString = extractJSON(from: response),
              let data = jsonString.data(using: .utf8) else {
            return nil
        }

        do {
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            return try decoder.decode(type, from: data)
        } catch {
            print("[JSONHelpers] Decode error: \(error)")
            return nil
        }
    }

    /// Extract a specific string value from a JSON response
    static func extractValue(key: String, from response: String) -> String? {
        guard let jsonString = extractJSON(from: response),
              let data = jsonString.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        if let value = dict[key] as? String {
            return value
        }

        // Try snake_case conversion
        let snakeKey = key.camelCaseToSnakeCase()
        return dict[snakeKey] as? String
    }

    /// Convert a dictionary to a JSON string
    static func toJSONString(_ dict: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]) else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    /// Convert an Encodable value to a JSON string
    static func encode<T: Encodable>(_ value: T) -> String? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - String Extensions

extension String {
    /// Convert camelCase to snake_case
    func camelCaseToSnakeCase() -> String {
        let pattern = "([a-z])([A-Z])"
        let regex = try? NSRegularExpression(pattern: pattern)
        let range = NSRange(startIndex..., in: self)
        return regex?.stringByReplacingMatches(
            in: self,
            range: range,
            withTemplate: "$1_$2"
        ).lowercased() ?? self.lowercased()
    }

    /// Convert snake_case to camelCase
    func snakeCaseToCamelCase() -> String {
        let components = split(separator: "_")
        guard let first = components.first else { return self }
        let rest = components.dropFirst().map { $0.capitalized }
        return String(first) + rest.joined()
    }
}

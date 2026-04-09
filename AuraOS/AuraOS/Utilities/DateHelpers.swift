import Foundation

// MARK: - Date Helpers

/// Date formatting and natural language date parsing utilities.
enum DateHelpers {

    // MARK: - Formatters (cached for performance)

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()

    private static let fullDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()

    private static let timeOnlyFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()

    // MARK: - Formatting

    /// Format a date as a relative string ("2 hours ago", "yesterday", etc.)
    static func formatRelativeDate(_ date: Date) -> String {
        let now = Date.now
        let interval = now.timeIntervalSince(date)

        // For very recent (< 1 minute)
        if interval < 60 {
            return "Just now"
        }

        // For today: show time only
        if Calendar.current.isDateInToday(date) {
            return timeOnlyFormatter.string(from: date)
        }

        // For yesterday
        if Calendar.current.isDateInYesterday(date) {
            return "Yesterday, \(timeOnlyFormatter.string(from: date))"
        }

        // For this week: relative
        if interval < 7 * 24 * 3600 {
            return relativeFormatter.localizedString(for: date, relativeTo: now)
        }

        // Older: full date
        return fullDateFormatter.string(from: date)
    }

    /// Format duration in seconds as "MM:SS" or "HH:MM:SS"
    static func formatDuration(_ seconds: TimeInterval) -> String {
        let totalSeconds = Int(seconds)
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let secs = totalSeconds % 60

        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, secs)
        }
        return String(format: "%02d:%02d", minutes, secs)
    }

    // MARK: - Natural Language Date Parsing

    /// Parse natural language date/time strings into Date objects.
    /// Supports: "tomorrow", "tomorrow at 9am", "in 2 hours", "next Monday",
    /// "9am", "3:30pm", "next week", "in 30 minutes", etc.
    static func parseNaturalLanguageDate(_ input: String) -> Date? {
        let lower = input.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let calendar = Calendar.current
        let now = Date.now

        // "now" / "right now"
        if lower == "now" || lower == "right now" {
            return now
        }

        // "in X minutes/hours/days"
        if lower.hasPrefix("in ") {
            return parseRelativeTime(lower, from: now)
        }

        // "tomorrow" / "tomorrow at X"
        if lower.hasPrefix("tomorrow") {
            var date = calendar.date(byAdding: .day, value: 1, to: now) ?? now
            if let timeStr = extractTime(from: lower) {
                date = setTime(timeStr, on: date) ?? date
            } else {
                // Default to 9:00 AM tomorrow
                date = calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date) ?? date
            }
            return date
        }

        // "today at X"
        if lower.hasPrefix("today") {
            if let timeStr = extractTime(from: lower) {
                return setTime(timeStr, on: now)
            }
            return now
        }

        // "next Monday/Tuesday/etc."
        if lower.hasPrefix("next ") {
            return parseNextDay(lower, from: now)
        }

        // Pure time: "9am", "3:30pm", "14:00"
        if let date = parseTimeOnly(lower, on: now) {
            return date
        }

        // Try system's data detector as last resort
        return parseWithDataDetector(input)
    }

    // MARK: - Private Parsers

    private static func parseRelativeTime(_ input: String, from now: Date) -> Date? {
        let calendar = Calendar.current

        // Extract number
        let numberPattern = /in\s+(\d+)\s+(minutes?|mins?|hours?|hrs?|days?|weeks?)/
        guard let match = input.firstMatch(of: numberPattern) else { return nil }

        let amount = Int(match.1) ?? 1
        let unit = String(match.2)

        switch unit {
        case "minute", "minutes", "min", "mins":
            return calendar.date(byAdding: .minute, value: amount, to: now)
        case "hour", "hours", "hr", "hrs":
            return calendar.date(byAdding: .hour, value: amount, to: now)
        case "day", "days":
            return calendar.date(byAdding: .day, value: amount, to: now)
        case "week", "weeks":
            return calendar.date(byAdding: .weekOfYear, value: amount, to: now)
        default:
            return nil
        }
    }

    private static func extractTime(from input: String) -> String? {
        // Match "at 9am", "at 3:30pm", "at 14:00"
        let timePattern = /at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/
        if let match = input.firstMatch(of: timePattern) {
            return String(match.1)
        }
        return nil
    }

    private static func setTime(_ timeStr: String, on date: Date) -> Date? {
        let calendar = Calendar.current
        let cleaned = timeStr.trimmingCharacters(in: .whitespaces).lowercased()

        var hour = 0
        var minute = 0

        // Match "9am", "9:30pm", "14:00"
        let timePattern = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/
        guard let match = cleaned.firstMatch(of: timePattern) else { return nil }

        hour = Int(match.1) ?? 0
        minute = Int(match.2 ?? "0") ?? 0
        let period = match.3.map { String($0) }

        // Handle AM/PM
        if let period {
            if period == "pm" && hour < 12 { hour += 12 }
            if period == "am" && hour == 12 { hour = 0 }
        }

        return calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date)
    }

    private static func parseNextDay(_ input: String, from now: Date) -> Date? {
        let calendar = Calendar.current
        let dayNames = [
            "sunday": 1, "monday": 2, "tuesday": 3, "wednesday": 4,
            "thursday": 5, "friday": 6, "saturday": 7,
        ]

        for (name, weekday) in dayNames {
            if input.contains(name) {
                // Find the next occurrence of this weekday
                var date = now
                for _ in 0..<7 {
                    guard let nextDate = calendar.date(byAdding: .day, value: 1, to: date) else { continue }
                    date = nextDate
                    if calendar.component(.weekday, from: date) == weekday {
                        // Default to 9 AM
                        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date)
                    }
                }
            }
        }

        // "next week" = next Monday at 9 AM
        if input.contains("week") {
            var date = now
            for _ in 0..<7 {
                guard let nextDate = calendar.date(byAdding: .day, value: 1, to: date) else { continue }
                date = nextDate
                if calendar.component(.weekday, from: date) == 2 { // Monday
                    return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date)
                }
            }
        }

        return nil
    }

    private static func parseTimeOnly(_ input: String, on date: Date) -> Date? {
        let timePattern = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/
        guard let match = input.firstMatch(of: timePattern) else { return nil }

        var hour = Int(match.1) ?? 0
        let minute = Int(match.2 ?? "0") ?? 0
        let period = match.3.map { String($0) }

        if let period {
            if period == "pm" && hour < 12 { hour += 12 }
            if period == "am" && hour == 12 { hour = 0 }
        }

        let calendar = Calendar.current
        var result = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: date) ?? date

        // If the time has already passed today, set it for tomorrow
        if result < date {
            result = calendar.date(byAdding: .day, value: 1, to: result) ?? result
        }

        return result
    }

    private static func parseWithDataDetector(_ input: String) -> Date? {
        let types: NSTextCheckingResult.CheckingType = [.date]
        guard let detector = try? NSDataDetector(types: types.rawValue) else { return nil }

        let range = NSRange(input.startIndex..., in: input)
        let matches = detector.matches(in: input, range: range)

        return matches.first?.date
    }
}

import XCTest
@testable import AuraOSLib

final class DateHelpersTests: XCTestCase {

    // MARK: - Relative Date Formatting

    func testJustNow() {
        let result = DateHelpers.formatRelativeDate(Date.now)
        XCTAssertEqual(result, "Just now")
    }

    func testTodayShowsTime() {
        let twoHoursAgo = Date.now.addingTimeInterval(-7200)
        let result = DateHelpers.formatRelativeDate(twoHoursAgo)
        // Should show time only for today (e.g., "2:30 PM")
        XCTAssertFalse(result.isEmpty)
        XCTAssertFalse(result.contains("ago"))
    }

    func testYesterday() {
        let yesterday = Date.now.addingTimeInterval(-86400 - 3600)
        let result = DateHelpers.formatRelativeDate(yesterday)
        XCTAssertTrue(result.contains("Yesterday"))
    }

    // MARK: - Duration Formatting

    func testDurationShort() {
        let result = DateHelpers.formatDuration(65)
        XCTAssertEqual(result, "01:05")
    }

    func testDurationLong() {
        let result = DateHelpers.formatDuration(3725)
        XCTAssertEqual(result, "1:02:05")
    }

    func testDurationZero() {
        let result = DateHelpers.formatDuration(0)
        XCTAssertEqual(result, "00:00")
    }

    // MARK: - Natural Language Date Parsing

    func testParseNow() {
        let result = DateHelpers.parseNaturalLanguageDate("now")
        XCTAssertNotNil(result)
    }

    func testParseTomorrow() {
        let result = DateHelpers.parseNaturalLanguageDate("tomorrow")
        XCTAssertNotNil(result)
        if let result {
            XCTAssertTrue(Calendar.current.isDateInTomorrow(result))
        }
    }

    func testParseTomorrowAtTime() {
        let result = DateHelpers.parseNaturalLanguageDate("tomorrow at 9am")
        XCTAssertNotNil(result)
        if let result {
            XCTAssertTrue(Calendar.current.isDateInTomorrow(result))
            let hour = Calendar.current.component(.hour, from: result)
            XCTAssertEqual(hour, 9)
        }
    }

    func testParseInMinutes() {
        let result = DateHelpers.parseNaturalLanguageDate("in 30 minutes")
        XCTAssertNotNil(result)
        if let result {
            let interval = result.timeIntervalSince(Date.now)
            // Should be approximately 30 minutes (±5 seconds)
            XCTAssert(abs(interval - 1800) < 5)
        }
    }

    func testParseInHours() {
        let result = DateHelpers.parseNaturalLanguageDate("in 2 hours")
        XCTAssertNotNil(result)
        if let result {
            let interval = result.timeIntervalSince(Date.now)
            XCTAssert(abs(interval - 7200) < 5)
        }
    }

    func testParseNextMonday() {
        let result = DateHelpers.parseNaturalLanguageDate("next monday")
        XCTAssertNotNil(result)
        if let result {
            let weekday = Calendar.current.component(.weekday, from: result)
            XCTAssertEqual(weekday, 2)  // Monday = 2
        }
    }

    func testParseInvalidDate() {
        let result = DateHelpers.parseNaturalLanguageDate("banana")
        XCTAssertNil(result)
    }

    // MARK: - JSON Helpers Integration

    func testCamelToSnakeCase() {
        XCTAssertEqual("contactName".camelCaseToSnakeCase(), "contact_name")
        XCTAssertEqual("dateTime".camelCaseToSnakeCase(), "date_time")
        XCTAssertEqual("brightnessLevel".camelCaseToSnakeCase(), "brightness_level")
    }

    func testSnakeToCamelCase() {
        XCTAssertEqual("contact_name".snakeCaseToCamelCase(), "contactName")
        XCTAssertEqual("date_time".snakeCaseToCamelCase(), "dateTime")
    }
}

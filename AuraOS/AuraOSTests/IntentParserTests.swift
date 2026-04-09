import XCTest
@testable import AuraOSLib

final class IntentParserTests: XCTestCase {

    let parser = IntentParser.shared

    // MARK: - System Command Tests (Rule-Based)

    func testFlashlightOn() async {
        let intent = await parser.parse(transcription: "Turn on the flashlight")
        XCTAssertEqual(intent.command, .flashlightOn)
    }

    func testFlashlightOff() async {
        let intent = await parser.parse(transcription: "Turn off flashlight")
        XCTAssertEqual(intent.command, .flashlightOff)
    }

    func testSetReminder() async {
        let intent = await parser.parse(transcription: "Remind me to call mom at 3pm")
        XCTAssertEqual(intent.category, .reminder)
        XCTAssertEqual(intent.command, .setReminder)
    }

    func testCreateEvent() async {
        let intent = await parser.parse(transcription: "Add to calendar meeting with Brian tomorrow at 2pm")
        XCTAssertEqual(intent.command, .createEvent)
    }

    func testReadCalendar() async {
        let intent = await parser.parse(transcription: "What's on my calendar today?")
        XCTAssertEqual(intent.command, .readCalendar)
    }

    func testMakeCall() async {
        let intent = await parser.parse(transcription: "Call Mom")
        XCTAssertEqual(intent.command, .makeCall)
        XCTAssertEqual(intent.entities.contactName, "Mom")
    }

    func testToggleDND() async {
        let intent = await parser.parse(transcription: "Turn off notifications for 2 hours")
        XCTAssertEqual(intent.command, .toggleDND)
    }

    func testTakePhoto() async {
        let intent = await parser.parse(transcription: "Take a photo")
        XCTAssertEqual(intent.command, .takePhoto)
    }

    // MARK: - Category Classification Tests

    func testNoteCategory() async {
        let intent = await parser.parse(transcription: "The meeting went well today")
        XCTAssertEqual(intent.category, .note)
        XCTAssertEqual(intent.command, .none)
    }

    func testIdeaCategory() async {
        let intent = await parser.parse(transcription: "I have an idea for a new feature")
        XCTAssertEqual(intent.category, .idea)
    }

    func testQueryCategory() async {
        let intent = await parser.parse(transcription: "What did I say about the wearable last week?")
        XCTAssertEqual(intent.category, .query)
    }

    func testTaskCategory() async {
        let intent = await parser.parse(transcription: "I need to finish the report")
        XCTAssertEqual(intent.category, .task)
    }

    func testActionCategory() async {
        let intent = await parser.parse(transcription: "Send email to Rafael about the portal update")
        XCTAssertEqual(intent.category, .action)
    }

    // MARK: - Confidence Tests

    func testHighConfidenceCommand() async {
        let intent = await parser.parse(transcription: "Turn on the flashlight")
        XCTAssert(intent.confidence >= 0.8)
    }

    func testLowerConfidenceGenericNote() async {
        let intent = await parser.parse(transcription: "random thoughts about life")
        XCTAssert(intent.confidence <= 0.6)
    }

    // MARK: - Entity Extraction Tests

    func testContactNameExtraction() async {
        let intent = await parser.parse(transcription: "Call John Smith")
        XCTAssertEqual(intent.entities.contactName, "John Smith")
    }

    // MARK: - Edge Cases

    func testEmptyTranscription() async {
        let intent = await parser.parse(transcription: "")
        XCTAssertEqual(intent.category, .note)
        XCTAssertEqual(intent.command, .none)
    }

    func testVeryLongTranscription() async {
        let longText = String(repeating: "This is a very long transcription. ", count: 100)
        let intent = await parser.parse(transcription: longText)
        XCTAssertNotNil(intent.category)
    }
}

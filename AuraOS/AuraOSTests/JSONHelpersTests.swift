import XCTest
@testable import AuraOSLib

final class JSONHelpersTests: XCTestCase {

    // MARK: - JSON Extraction

    func testExtractCleanJSON() {
        let input = """
        {"category": "note", "command": "none"}
        """
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("category"))
    }

    func testExtractJSONFromMarkdownFence() {
        let input = """
        ```json
        {"category": "reminder", "command": "set_reminder"}
        ```
        """
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("reminder"))
    }

    func testExtractJSONFromCodeFence() {
        let input = """
        ```
        {"key": "value"}
        ```
        """
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNotNil(result)
    }

    func testExtractJSONWithSurroundingText() {
        let input = """
        Here is the result:
        {"category": "task", "confidence": 0.9}
        Hope that helps!
        """
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("task"))
    }

    func testExtractJSONArray() {
        let input = """
        ["tag1", "tag2", "tag3"]
        """
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.hasPrefix("["))
    }

    func testExtractNoJSON() {
        let input = "This is just plain text with no JSON"
        let result = JSONHelpers.extractJSON(from: input)
        XCTAssertNil(result)
    }

    // MARK: - Decode

    func testDecodeStruct() {
        struct TestModel: Codable {
            let name: String
            let value: Int
        }

        let input = """
        {"name": "test", "value": 42}
        """
        let result = JSONHelpers.decode(TestModel.self, from: input)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.name, "test")
        XCTAssertEqual(result?.value, 42)
    }

    func testDecodeFromMarkdownFence() {
        struct Category: Codable {
            let category: String
        }

        let input = """
        ```json
        {"category": "idea"}
        ```
        """
        let result = JSONHelpers.decode(Category.self, from: input)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.category, "idea")
    }

    // MARK: - Extract Value

    func testExtractValue() {
        let input = """
        {"category": "note", "confidence": 0.8}
        """
        let result = JSONHelpers.extractValue(key: "category", from: input)
        XCTAssertEqual(result, "note")
    }

    func testExtractValueNotFound() {
        let input = """
        {"category": "note"}
        """
        let result = JSONHelpers.extractValue(key: "missing", from: input)
        XCTAssertNil(result)
    }

    // MARK: - Encode

    func testToJSONString() {
        let dict: [String: Any] = ["name": "test", "value": 42]
        let result = JSONHelpers.toJSONString(dict)
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("test"))
    }

    func testEncodeEncodable() {
        struct TestModel: Encodable {
            let name: String
        }

        let result = JSONHelpers.encode(TestModel(name: "hello"))
        XCTAssertNotNil(result)
        XCTAssertTrue(result!.contains("hello"))
    }
}

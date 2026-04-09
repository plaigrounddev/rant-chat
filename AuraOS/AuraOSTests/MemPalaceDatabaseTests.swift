import XCTest
@testable import AuraOSLib

final class MemPalaceDatabaseTests: XCTestCase {

    var database: MemPalaceDatabase!
    var tempPath: String!

    override func setUp() {
        super.setUp()
        tempPath = NSTemporaryDirectory() + "test_mempalace_\(UUID().uuidString).sqlite3"
        database = MemPalaceDatabase(path: tempPath)
    }

    override func tearDown() {
        database = nil
        if let tempPath {
            try? FileManager.default.removeItem(atPath: tempPath)
        }
        tempPath = nil
        super.tearDown()
    }

    // MARK: - Memory Tests

    func testInsertAndRetrieveMemory() throws {
        let memory = Memory(
            type: .semantic,
            content: "The user prefers bullet-point responses",
            tags: ["preference", "formatting"]
        )

        try database.insertMemory(memory)

        let memories = try database.getAllMemories()
        XCTAssertEqual(memories.count, 1)
        XCTAssertEqual(memories.first?.content, "The user prefers bullet-point responses")
        XCTAssertEqual(memories.first?.type, .semantic)
        XCTAssertEqual(memories.first?.tags, ["preference", "formatting"])
    }

    func testSearchMemoriesByText() throws {
        let memories = [
            Memory(type: .semantic, content: "User works at a tech startup"),
            Memory(type: .episodic, content: "Had a meeting with the design team"),
            Memory(type: .semantic, content: "User prefers dark mode"),
        ]

        for m in memories {
            try database.insertMemory(m)
        }

        let results = try database.searchMemories(query: "dark mode")
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?.content, "User prefers dark mode")
    }

    func testFilterMemoriesByType() throws {
        try database.insertMemory(Memory(type: .semantic, content: "Fact 1"))
        try database.insertMemory(Memory(type: .episodic, content: "Event 1"))
        try database.insertMemory(Memory(type: .semantic, content: "Fact 2"))

        let semantic = try database.getAllMemories(type: .semantic)
        XCTAssertEqual(semantic.count, 2)

        let episodic = try database.getAllMemories(type: .episodic)
        XCTAssertEqual(episodic.count, 1)
    }

    func testDeleteMemory() throws {
        let memory = Memory(type: .semantic, content: "Test memory")
        try database.insertMemory(memory)

        XCTAssertEqual(try database.memoryCount(), 1)

        try database.deleteMemory(id: memory.id)
        XCTAssertEqual(try database.memoryCount(), 0)
    }

    func testUnsyncedMemories() throws {
        try database.insertMemory(Memory(type: .semantic, content: "Unsynced"))
        let unsynced = try database.getUnsyncedMemories()
        XCTAssertEqual(unsynced.count, 1)

        try database.markMemorySynced(id: unsynced.first!.id)
        let afterSync = try database.getUnsyncedMemories()
        XCTAssertEqual(afterSync.count, 0)
    }

    // MARK: - Note Tests

    func testInsertAndRetrieveNote() throws {
        let note = Note(
            category: .idea,
            rawTranscription: "I think we should add a dark mode toggle",
            content: "Add dark mode toggle",
            tags: ["feature", "ui"]
        )

        try database.insertNote(note)

        let notes = try database.getAllNotes()
        XCTAssertEqual(notes.count, 1)
        XCTAssertEqual(notes.first?.category, .idea)
        XCTAssertEqual(notes.first?.content, "Add dark mode toggle")
    }

    func testFilterNotesByCategory() throws {
        try database.insertNote(Note(category: .note, rawTranscription: "Note 1", content: "Note 1"))
        try database.insertNote(Note(category: .task, rawTranscription: "Task 1", content: "Task 1"))
        try database.insertNote(Note(category: .idea, rawTranscription: "Idea 1", content: "Idea 1"))
        try database.insertNote(Note(category: .task, rawTranscription: "Task 2", content: "Task 2"))

        let tasks = try database.getAllNotes(category: .task)
        XCTAssertEqual(tasks.count, 2)

        let ideas = try database.getAllNotes(category: .idea)
        XCTAssertEqual(ideas.count, 1)
    }

    func testSearchNotes() throws {
        try database.insertNote(Note(category: .note, rawTranscription: "meeting with Brian", content: "Meeting with Brian about ISA portal"))
        try database.insertNote(Note(category: .note, rawTranscription: "lunch plans", content: "Lunch at noon today"))

        let results = try database.searchNotes(query: "Brian")
        XCTAssertEqual(results.count, 1)
        XCTAssertTrue(results.first!.content.contains("Brian"))
    }

    func testDeleteNote() throws {
        let note = Note(category: .note, rawTranscription: "test", content: "Test note")
        try database.insertNote(note)
        XCTAssertEqual(try database.noteCount(), 1)

        try database.deleteNote(id: note.id)
        XCTAssertEqual(try database.noteCount(), 0)
    }

    // MARK: - Action Queue Tests

    func testEnqueueAndRetrieveAction() throws {
        let action = QueuedAction(
            type: .sendEmail,
            title: "Send email to Rafael",
            payload: "{\"to\": \"rafael@example.com\"}"
        )

        try database.enqueueAction(action)

        let pending = try database.getPendingActions()
        XCTAssertEqual(pending.count, 1)
        XCTAssertEqual(pending.first?.title, "Send email to Rafael")
        XCTAssertEqual(pending.first?.type, .sendEmail)
        XCTAssertEqual(pending.first?.status, .pending)
    }

    func testUpdateActionStatus() throws {
        let action = QueuedAction(type: .postSlack, title: "Post to Slack", payload: "{}")
        try database.enqueueAction(action)

        try database.updateActionStatus(id: action.id, status: .completed)

        let pending = try database.getPendingActions()
        XCTAssertEqual(pending.count, 0)

        let all = try database.getAllActions()
        XCTAssertEqual(all.first?.status, .completed)
    }

    func testActionError() throws {
        let action = QueuedAction(type: .sendEmail, title: "Send email", payload: "{}")
        try database.enqueueAction(action)

        try database.updateActionStatus(id: action.id, status: .failed, error: "API error: 401")

        let all = try database.getAllActions()
        XCTAssertEqual(all.first?.status, .failed)
        XCTAssertEqual(all.first?.errorMessage, "API error: 401")
    }

    // MARK: - Settings Tests

    func testSetAndGetSetting() throws {
        try database.setSetting(key: "theme", value: "dark")
        let value = try database.getSetting(key: "theme")
        XCTAssertEqual(value, "dark")
    }

    func testUpdateSetting() throws {
        try database.setSetting(key: "theme", value: "dark")
        try database.setSetting(key: "theme", value: "light")
        let value = try database.getSetting(key: "theme")
        XCTAssertEqual(value, "light")
    }

    func testGetNonexistentSetting() throws {
        let value = try database.getSetting(key: "nonexistent")
        XCTAssertNil(value)
    }

    // MARK: - Stats Tests

    func testCounts() throws {
        try database.insertMemory(Memory(type: .semantic, content: "Memory 1"))
        try database.insertMemory(Memory(type: .semantic, content: "Memory 2"))
        try database.insertNote(Note(category: .note, rawTranscription: "Note", content: "Note"))
        try database.enqueueAction(QueuedAction(type: .sendEmail, title: "Email", payload: "{}"))

        XCTAssertEqual(try database.memoryCount(), 2)
        XCTAssertEqual(try database.noteCount(), 1)
        XCTAssertEqual(try database.pendingActionCount(), 1)
    }

    // MARK: - Vector Search Tests

    func testVectorSimilaritySearch() throws {
        // Insert memories with mock embeddings
        var m1 = Memory(type: .semantic, content: "User likes coffee")
        m1.embedding = [1.0, 0.0, 0.0]
        try database.insertMemory(m1)

        var m2 = Memory(type: .semantic, content: "User likes tea")
        m2.embedding = [0.9, 0.1, 0.0]
        try database.insertMemory(m2)

        var m3 = Memory(type: .semantic, content: "Meeting at 3pm")
        m3.embedding = [0.0, 0.0, 1.0]
        try database.insertMemory(m3)

        // Search with embedding similar to coffee/tea
        let results = try database.searchMemoriesByEmbedding([1.0, 0.0, 0.0], limit: 2)
        XCTAssertEqual(results.count, 2)

        // First result should be the most similar (exact match)
        XCTAssertEqual(results.first?.0.content, "User likes coffee")
        XCTAssert(results.first!.1 > 0.99) // Very high similarity
    }
}

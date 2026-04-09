import Foundation
import SQLite

// MARK: - MemPalace SQLite Database

/// Low-level SQLite database layer for MemPalace persistent storage.
/// Handles all CRUD operations, schema migrations, and vector similarity search.
final class MemPalaceDatabase {

    // MARK: - Singleton

    static let shared = MemPalaceDatabase()

    // MARK: - Database Connection

    private var db: Connection?

    // MARK: - Table Definitions

    // Memories table
    private let memories = Table("memories")
    private let memId = SQLite.Expression<String>("id")
    private let memType = SQLite.Expression<String>("type")
    private let memContent = SQLite.Expression<String>("content")
    private let memTags = SQLite.Expression<String>("tags")           // JSON array
    private let memEmbedding = SQLite.Expression<Data?>("embedding")  // Float array as Data
    private let memTimestamp = SQLite.Expression<Double>("timestamp")
    private let memUpdatedAt = SQLite.Expression<Double>("updated_at")
    private let memIsSynced = SQLite.Expression<Bool>("is_synced")

    // Notes table
    private let notes = Table("notes")
    private let noteId = SQLite.Expression<String>("id")
    private let noteCategory = SQLite.Expression<String>("category")
    private let noteRawText = SQLite.Expression<String>("raw_transcription")
    private let noteContent = SQLite.Expression<String>("content")
    private let noteTags = SQLite.Expression<String>("tags")           // JSON array
    private let noteEmbedding = SQLite.Expression<Data?>("embedding")  // Float array as Data
    private let noteTimestamp = SQLite.Expression<Double>("timestamp")
    private let noteLocation = SQLite.Expression<String?>("context_location")
    private let noteIsSynced = SQLite.Expression<Bool>("is_synced")

    // Action queue table
    private let actions = Table("action_queue")
    private let actionId = SQLite.Expression<String>("id")
    private let actionType = SQLite.Expression<String>("type")
    private let actionTitle = SQLite.Expression<String>("title")
    private let actionPayload = SQLite.Expression<String>("payload")
    private let actionStatus = SQLite.Expression<String>("status")
    private let actionCreatedAt = SQLite.Expression<Double>("created_at")
    private let actionExecutedAt = SQLite.Expression<Double?>("executed_at")
    private let actionError = SQLite.Expression<String?>("error_message")
    private let actionRequiresConfirm = SQLite.Expression<Bool>("requires_confirmation")

    // Settings table
    private let settings = Table("settings")
    private let settingKey = SQLite.Expression<String>("key")
    private let settingValue = SQLite.Expression<String>("value")

    // MARK: - Initialization

    private init() {
        do {
            let path = MemPalaceDatabase.databasePath()
            db = try Connection(path)
            db?.busyTimeout = 5
            try createTables()
        } catch {
            print("[MemPalace] Database initialization failed: \(error)")
        }
    }

    /// For testing — accepts a custom database path
    init(path: String) {
        do {
            db = try Connection(path)
            db?.busyTimeout = 5
            try createTables()
        } catch {
            print("[MemPalace] Database initialization failed: \(error)")
        }
    }

    private static func databasePath() -> String {
        let documentsPath = NSSearchPathForDirectoriesInDomains(
            .documentDirectory, .userDomainMask, true
        ).first!
        return "\(documentsPath)/mempalace.sqlite3"
    }

    // MARK: - Schema Creation

    private func createTables() throws {
        guard let db else { return }

        try db.run(memories.create(ifNotExists: true) { t in
            t.column(memId, primaryKey: true)
            t.column(memType)
            t.column(memContent)
            t.column(memTags)
            t.column(memEmbedding)
            t.column(memTimestamp)
            t.column(memUpdatedAt)
            t.column(memIsSynced, defaultValue: false)
        })

        try db.run(notes.create(ifNotExists: true) { t in
            t.column(noteId, primaryKey: true)
            t.column(noteCategory)
            t.column(noteRawText)
            t.column(noteContent)
            t.column(noteTags)
            t.column(noteEmbedding)
            t.column(noteTimestamp)
            t.column(noteLocation)
            t.column(noteIsSynced, defaultValue: false)
        })

        try db.run(actions.create(ifNotExists: true) { t in
            t.column(actionId, primaryKey: true)
            t.column(actionType)
            t.column(actionTitle)
            t.column(actionPayload)
            t.column(actionStatus, defaultValue: ActionStatus.pending.rawValue)
            t.column(actionCreatedAt)
            t.column(actionExecutedAt)
            t.column(actionError)
            t.column(actionRequiresConfirm, defaultValue: true)
        })

        try db.run(settings.create(ifNotExists: true) { t in
            t.column(settingKey, primaryKey: true)
            t.column(settingValue)
        })

        // Indexes for common queries
        try db.run(memories.createIndex(memType, ifNotExists: true))
        try db.run(memories.createIndex(memTimestamp, ifNotExists: true))
        try db.run(notes.createIndex(noteCategory, ifNotExists: true))
        try db.run(notes.createIndex(noteTimestamp, ifNotExists: true))
        try db.run(actions.createIndex(actionStatus, ifNotExists: true))
    }

    // MARK: - Memory CRUD

    func insertMemory(_ memory: Memory) throws {
        guard let db else { throw AuraDBError.notConnected }

        let tagsJSON = try JSONEncoder().encode(memory.tags)

        try db.run(memories.insert(or: .replace,
            memId <- memory.id,
            memType <- memory.type.rawValue,
            memContent <- memory.content,
            memTags <- String(data: tagsJSON, encoding: .utf8) ?? "[]",
            memEmbedding <- memory.embedding.map { encodeFloatArray($0) },
            memTimestamp <- memory.timestamp.timeIntervalSince1970,
            memUpdatedAt <- memory.updatedAt.timeIntervalSince1970,
            memIsSynced <- memory.isSynced
        ))
    }

    func getAllMemories(type: MemoryType? = nil, limit: Int = 100) throws -> [Memory] {
        guard let db else { throw AuraDBError.notConnected }

        var query = memories.order(memTimestamp.desc).limit(limit)
        if let type {
            query = query.filter(memType == type.rawValue)
        }

        return try db.prepare(query).map { row in
            try rowToMemory(row)
        }
    }

    func searchMemories(query: String, limit: Int = 20) throws -> [Memory] {
        guard let db else { throw AuraDBError.notConnected }

        let pattern = "%\(query.lowercased())%"
        let results = memories
            .filter(memContent.lowercaseString.like(pattern) || memTags.lowercaseString.like(pattern))
            .order(memTimestamp.desc)
            .limit(limit)

        return try db.prepare(results).map { row in
            try rowToMemory(row)
        }
    }

    /// Vector similarity search using cosine distance
    func searchMemoriesByEmbedding(_ queryEmbedding: [Float], limit: Int = 10) throws -> [(Memory, Float)] {
        guard let db else { throw AuraDBError.notConnected }

        // Load all memories with embeddings and compute similarity in-memory
        // (SQLite doesn't support vector operations natively)
        let allWithEmbeddings = memories.filter(memEmbedding != nil)
        var results: [(Memory, Float)] = []

        for row in try db.prepare(allWithEmbeddings) {
            let memory = try rowToMemory(row)
            guard let embedding = memory.embedding else { continue }
            let similarity = cosineSimilarity(queryEmbedding, embedding)
            results.append((memory, similarity))
        }

        // Sort by similarity descending and take top N
        results.sort { $0.1 > $1.1 }
        return Array(results.prefix(limit))
    }

    func deleteMemory(id: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(memories.filter(memId == id).delete())
    }

    func getUnsyncedMemories() throws -> [Memory] {
        guard let db else { throw AuraDBError.notConnected }
        let query = memories.filter(memIsSynced == false)
        return try db.prepare(query).map { try rowToMemory($0) }
    }

    func markMemorySynced(id: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(memories.filter(memId == id).update(memIsSynced <- true))
    }

    // MARK: - Note CRUD

    func insertNote(_ note: Note) throws {
        guard let db else { throw AuraDBError.notConnected }

        let tagsJSON = try JSONEncoder().encode(note.tags)

        try db.run(notes.insert(or: .replace,
            noteId <- note.id,
            noteCategory <- note.category.rawValue,
            noteRawText <- note.rawTranscription,
            noteContent <- note.content,
            noteTags <- String(data: tagsJSON, encoding: .utf8) ?? "[]",
            noteEmbedding <- note.embedding.map { encodeFloatArray($0) },
            noteTimestamp <- note.timestamp.timeIntervalSince1970,
            noteLocation <- note.contextLocation,
            noteIsSynced <- note.isSynced
        ))
    }

    func getAllNotes(category: NoteCategory? = nil, limit: Int = 100) throws -> [Note] {
        guard let db else { throw AuraDBError.notConnected }

        var query = notes.order(noteTimestamp.desc).limit(limit)
        if let category {
            query = query.filter(noteCategory == category.rawValue)
        }

        return try db.prepare(query).map { row in
            try rowToNote(row)
        }
    }

    func searchNotes(query: String, category: NoteCategory? = nil, limit: Int = 20) throws -> [Note] {
        guard let db else { throw AuraDBError.notConnected }

        let pattern = "%\(query.lowercased())%"
        var q = notes
            .filter(noteContent.lowercaseString.like(pattern) || noteRawText.lowercaseString.like(pattern))
            .order(noteTimestamp.desc)
            .limit(limit)

        if let category {
            q = q.filter(noteCategory == category.rawValue)
        }

        return try db.prepare(q).map { try rowToNote($0) }
    }

    /// Vector similarity search for notes
    func searchNotesByEmbedding(_ queryEmbedding: [Float], limit: Int = 10) throws -> [(Note, Float)] {
        guard let db else { throw AuraDBError.notConnected }

        let allWithEmbeddings = notes.filter(noteEmbedding != nil)
        var results: [(Note, Float)] = []

        for row in try db.prepare(allWithEmbeddings) {
            let note = try rowToNote(row)
            guard let embedding = note.embedding else { continue }
            let similarity = cosineSimilarity(queryEmbedding, embedding)
            results.append((note, similarity))
        }

        results.sort { $0.1 > $1.1 }
        return Array(results.prefix(limit))
    }

    func deleteNote(id: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(notes.filter(noteId == id).delete())
    }

    func getUnsyncedNotes() throws -> [Note] {
        guard let db else { throw AuraDBError.notConnected }
        let query = notes.filter(noteIsSynced == false)
        return try db.prepare(query).map { try rowToNote($0) }
    }

    func markNoteSynced(id: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(notes.filter(noteId == id).update(noteIsSynced <- true))
    }

    // MARK: - Action Queue CRUD

    func enqueueAction(_ action: QueuedAction) throws {
        guard let db else { throw AuraDBError.notConnected }

        try db.run(actions.insert(or: .replace,
            actionId <- action.id,
            actionType <- action.type.rawValue,
            actionTitle <- action.title,
            actionPayload <- action.payload,
            actionStatus <- action.status.rawValue,
            actionCreatedAt <- action.createdAt.timeIntervalSince1970,
            actionExecutedAt <- action.executedAt?.timeIntervalSince1970,
            actionError <- action.errorMessage,
            actionRequiresConfirm <- action.requiresConfirmation
        ))
    }

    func getPendingActions() throws -> [QueuedAction] {
        guard let db else { throw AuraDBError.notConnected }

        let query = actions
            .filter(actionStatus == ActionStatus.pending.rawValue)
            .order(actionCreatedAt.asc)

        return try db.prepare(query).map { try rowToAction($0) }
    }

    func getAllActions(limit: Int = 100) throws -> [QueuedAction] {
        guard let db else { throw AuraDBError.notConnected }

        let query = actions.order(actionCreatedAt.desc).limit(limit)
        return try db.prepare(query).map { try rowToAction($0) }
    }

    func updateActionStatus(id: String, status: ActionStatus, error: String? = nil) throws {
        guard let db else { throw AuraDBError.notConnected }

        var setters: [SQLite.Setter] = [actionStatus <- status.rawValue]
        if status == .completed || status == .failed {
            setters.append(actionExecutedAt <- Date.now.timeIntervalSince1970)
        }
        if let error {
            setters.append(actionError <- error)
        }

        try db.run(actions.filter(actionId == id).update(setters))
    }

    func deleteAction(id: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(actions.filter(actionId == id).delete())
    }

    // MARK: - Settings

    func setSetting(key: String, value: String) throws {
        guard let db else { throw AuraDBError.notConnected }
        try db.run(settings.insert(or: .replace,
            settingKey <- key,
            settingValue <- value
        ))
    }

    func getSetting(key: String) throws -> String? {
        guard let db else { throw AuraDBError.notConnected }
        return try db.pluck(settings.filter(settingKey == key)).map { $0[settingValue] }
    }

    // MARK: - Stats

    func memoryCount() throws -> Int {
        guard let db else { throw AuraDBError.notConnected }
        return try db.scalar(memories.count)
    }

    func noteCount() throws -> Int {
        guard let db else { throw AuraDBError.notConnected }
        return try db.scalar(notes.count)
    }

    func pendingActionCount() throws -> Int {
        guard let db else { throw AuraDBError.notConnected }
        return try db.scalar(actions.filter(actionStatus == ActionStatus.pending.rawValue).count)
    }

    // MARK: - Helpers

    private func rowToMemory(_ row: Row) throws -> Memory {
        let tagsData = row[memTags].data(using: .utf8) ?? Data()
        let tags = (try? JSONDecoder().decode([String].self, from: tagsData)) ?? []
        let embedding = row[memEmbedding].map { decodeFloatArray($0) }

        return Memory(
            id: row[memId],
            type: MemoryType(rawValue: row[memType]) ?? .semantic,
            content: row[memContent],
            tags: tags,
            embedding: embedding,
            timestamp: Date(timeIntervalSince1970: row[memTimestamp]),
            updatedAt: Date(timeIntervalSince1970: row[memUpdatedAt]),
            isSynced: row[memIsSynced]
        )
    }

    private func rowToNote(_ row: Row) throws -> Note {
        let tagsData = row[noteTags].data(using: .utf8) ?? Data()
        let tags = (try? JSONDecoder().decode([String].self, from: tagsData)) ?? []
        let embedding = row[noteEmbedding].map { decodeFloatArray($0) }

        return Note(
            id: row[noteId],
            category: NoteCategory(rawValue: row[noteCategory]) ?? .note,
            rawTranscription: row[noteRawText],
            content: row[noteContent],
            tags: tags,
            embedding: embedding,
            timestamp: Date(timeIntervalSince1970: row[noteTimestamp]),
            contextLocation: row[noteLocation],
            isSynced: row[noteIsSynced]
        )
    }

    private func rowToAction(_ row: Row) throws -> QueuedAction {
        return QueuedAction(
            id: row[actionId],
            type: OnlineActionType(rawValue: row[actionType]) ?? .custom,
            title: row[actionTitle],
            payload: row[actionPayload],
            status: ActionStatus(rawValue: row[actionStatus]) ?? .pending,
            createdAt: Date(timeIntervalSince1970: row[actionCreatedAt]),
            executedAt: row[actionExecutedAt].map { Date(timeIntervalSince1970: $0) },
            errorMessage: row[actionError],
            requiresConfirmation: row[actionRequiresConfirm]
        )
    }

    // MARK: - Vector Operations

    /// Encode Float array to Data for SQLite BLOB storage
    private func encodeFloatArray(_ floats: [Float]) -> Data {
        return floats.withUnsafeBufferPointer { buffer in
            Data(buffer: buffer)
        }
    }

    /// Decode Data (BLOB) back to Float array
    private func decodeFloatArray(_ data: Data) -> [Float] {
        var floats = Array(
            repeating: Float.zero,
            count: data.count / MemoryLayout<Float>.stride
        )
        _ = floats.withUnsafeMutableBytes { data.copyBytes(to: $0) }
        return floats
    }

    /// Cosine similarity between two float vectors
    private func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return 0 }

        var dotProduct: Float = 0
        var normA: Float = 0
        var normB: Float = 0

        for i in 0..<a.count {
            dotProduct += a[i] * b[i]
            normA += a[i] * a[i]
            normB += b[i] * b[i]
        }

        let denominator = sqrt(normA) * sqrt(normB)
        guard denominator > 0 else { return 0 }
        return dotProduct / denominator
    }
}

// MARK: - Errors

enum AuraDBError: Error, LocalizedError {
    case notConnected
    case encodingFailed
    case decodingFailed

    var errorDescription: String? {
        switch self {
        case .notConnected: return "Database not connected"
        case .encodingFailed: return "Failed to encode data"
        case .decodingFailed: return "Failed to decode data"
        }
    }
}

import Foundation
import Observation

// MARK: - MemPalace Manager

/// High-level API for the MemPalace persistent memory system.
/// Wraps the SQLite database with caching, embedding generation, and semantic search.
@Observable
final class MemPalaceManager {

    // MARK: - Singleton

    static let shared = MemPalaceManager()

    // MARK: - Published State

    var memoryCount: Int = 0
    var noteCount: Int = 0
    var pendingActionCount: Int = 0

    // MARK: - Private

    private let database: MemPalaceDatabase
    private var cachedMemories: [Memory] = []
    private var cachedNotes: [Note] = []

    // MARK: - Init

    private init() {
        self.database = MemPalaceDatabase.shared
        refreshStats()
    }

    /// For testing with a custom database
    init(database: MemPalaceDatabase) {
        self.database = database
        refreshStats()
    }

    // MARK: - Memory Operations

    /// Save a new memory to MemPalace, optionally generating an embedding
    func remember(content: String, type: MemoryType, tags: [String] = []) async {
        // Generate embedding if LLM is available
        var embedding: [Float]? = nil
        if LLMService.shared.isLoaded {
            embedding = await LLMService.shared.getEmbedding(text: content)
        }

        let memory = Memory(
            type: type,
            content: content,
            tags: tags,
            embedding: embedding
        )

        do {
            try database.insertMemory(memory)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to save memory: \(error)")
        }
    }

    /// Recall memories matching a query (text search + optional vector search)
    func recall(query: String, type: MemoryType? = nil, limit: Int = 10) async -> [Memory] {
        do {
            // First try vector search if LLM is available
            if LLMService.shared.isLoaded,
               let queryEmbedding = await LLMService.shared.getEmbedding(text: query) {
                let vectorResults = try database.searchMemoriesByEmbedding(queryEmbedding, limit: limit)
                if !vectorResults.isEmpty {
                    return vectorResults.map { $0.0 }
                }
            }

            // Fallback to text search
            return try database.searchMemories(query: query, limit: limit)
        } catch {
            print("[MemPalace] Recall failed: \(error)")
            return []
        }
    }

    /// Get all memories, optionally filtered by type
    func getAllMemories(type: MemoryType? = nil) -> [Memory] {
        do {
            return try database.getAllMemories(type: type)
        } catch {
            print("[MemPalace] Failed to get memories: \(error)")
            return []
        }
    }

    /// Delete a memory by ID
    func forgetMemory(id: String) {
        do {
            try database.deleteMemory(id: id)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to delete memory: \(error)")
        }
    }

    // MARK: - Note Operations

    /// Add a new note (typically from voice capture pipeline)
    func addNote(
        rawTranscription: String,
        content: String,
        category: NoteCategory,
        tags: [String] = [],
        location: String? = nil
    ) async {
        var embedding: [Float]? = nil
        if LLMService.shared.isLoaded {
            embedding = await LLMService.shared.getEmbedding(text: content)
        }

        let note = Note(
            category: category,
            rawTranscription: rawTranscription,
            content: content,
            tags: tags,
            embedding: embedding,
            contextLocation: location
        )

        do {
            try database.insertNote(note)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to save note: \(error)")
        }
    }

    /// Search notes with natural language query
    func findNotes(query: String, category: NoteCategory? = nil, limit: Int = 20) async -> [Note] {
        do {
            // Try vector search first
            if LLMService.shared.isLoaded,
               let queryEmbedding = await LLMService.shared.getEmbedding(text: query) {
                let vectorResults = try database.searchNotesByEmbedding(queryEmbedding, limit: limit)
                if !vectorResults.isEmpty {
                    return vectorResults.map { $0.0 }
                }
            }

            // Fallback to text search
            return try database.searchNotes(query: query, category: category, limit: limit)
        } catch {
            print("[MemPalace] Note search failed: \(error)")
            return []
        }
    }

    /// Get all notes, optionally filtered by category
    func getAllNotes(category: NoteCategory? = nil) -> [Note] {
        do {
            return try database.getAllNotes(category: category)
        } catch {
            print("[MemPalace] Failed to get notes: \(error)")
            return []
        }
    }

    /// Delete a note by ID
    func deleteNote(id: String) {
        do {
            try database.deleteNote(id: id)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to delete note: \(error)")
        }
    }

    // MARK: - Action Queue

    /// Queue an action for online execution
    func enqueueAction(
        type: OnlineActionType,
        title: String,
        payload: String,
        requiresConfirmation: Bool = true
    ) {
        let action = QueuedAction(
            type: type,
            title: title,
            payload: payload,
            requiresConfirmation: requiresConfirmation
        )

        do {
            try database.enqueueAction(action)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to enqueue action: \(error)")
        }
    }

    /// Get all pending actions
    func getPendingActions() -> [QueuedAction] {
        do {
            return try database.getPendingActions()
        } catch {
            print("[MemPalace] Failed to get pending actions: \(error)")
            return []
        }
    }

    /// Get all actions (for history view)
    func getAllActions() -> [QueuedAction] {
        do {
            return try database.getAllActions()
        } catch {
            print("[MemPalace] Failed to get actions: \(error)")
            return []
        }
    }

    /// Update action status
    func updateAction(id: String, status: ActionStatus, error: String? = nil) {
        do {
            try database.updateActionStatus(id: id, status: status, error: error)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to update action: \(error)")
        }
    }

    /// Delete an action
    func deleteAction(id: String) {
        do {
            try database.deleteAction(id: id)
            refreshStats()
        } catch {
            print("[MemPalace] Failed to delete action: \(error)")
        }
    }

    // MARK: - Sync Support

    /// Get all unsynced memories for Convex cloud sync
    func getUnsyncedMemories() -> [Memory] {
        (try? database.getUnsyncedMemories()) ?? []
    }

    /// Get all unsynced notes for Convex cloud sync
    func getUnsyncedNotes() -> [Note] {
        (try? database.getUnsyncedNotes()) ?? []
    }

    /// Mark a memory as synced after successful Convex upload
    func markMemorySynced(id: String) {
        try? database.markMemorySynced(id: id)
    }

    /// Mark a note as synced after successful Convex upload
    func markNoteSynced(id: String) {
        try? database.markNoteSynced(id: id)
    }

    // MARK: - Settings

    func setSetting(key: String, value: String) {
        try? database.setSetting(key: key, value: value)
    }

    func getSetting(key: String) -> String? {
        try? database.getSetting(key: key)
    }

    // MARK: - Stats

    func getStats() -> AuraStats {
        AuraStats(
            memoryCount: memoryCount,
            noteCount: noteCount,
            pendingActionCount: pendingActionCount,
            isOnline: NetworkMonitor.shared.isConnected,
            modelLoaded: LLMService.shared.isLoaded
        )
    }

    func refreshStats() {
        memoryCount = (try? database.memoryCount()) ?? 0
        noteCount = (try? database.noteCount()) ?? 0
        pendingActionCount = (try? database.pendingActionCount()) ?? 0
    }
}

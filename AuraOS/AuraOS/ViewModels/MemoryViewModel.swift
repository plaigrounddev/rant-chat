import Foundation
import Observation

// MARK: - Memory View Model

/// Manages memory search, listing, and CRUD operations.
@Observable
final class MemoryViewModel {

    // MARK: - State

    var allMemories: [Memory] = []
    var searchResults: [Memory] = []
    var isSearching: Bool = false
    var selectedType: MemoryType?

    // MARK: - Private

    private let memPalace = MemPalaceManager.shared

    // MARK: - Load

    func loadMemories() {
        allMemories = memPalace.getAllMemories(type: selectedType)
    }

    // MARK: - Filter

    func filterByType(_ type: MemoryType?) {
        selectedType = type
        loadMemories()
    }

    // MARK: - Search

    func search(query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            searchResults = []
            return
        }

        isSearching = true
        searchResults = await memPalace.recall(query: trimmed, type: selectedType, limit: 20)
        isSearching = false
    }

    // MARK: - CRUD

    func addMemory(content: String, type: MemoryType) async {
        await memPalace.remember(content: content, type: type)
        loadMemories()
    }

    func deleteMemory(id: String) {
        memPalace.forgetMemory(id: id)
        loadMemories()
        // Also remove from search results
        searchResults.removeAll { $0.id == id }
    }

    // MARK: - Stats

    var memoryStats: (total: Int, episodic: Int, semantic: Int, procedural: Int) {
        let all = memPalace.getAllMemories()
        return (
            total: all.count,
            episodic: all.filter { $0.type == .episodic }.count,
            semantic: all.filter { $0.type == .semantic }.count,
            procedural: all.filter { $0.type == .procedural }.count
        )
    }
}

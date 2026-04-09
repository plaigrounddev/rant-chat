import Foundation
import Observation

// MARK: - Notes View Model

/// Manages note listing, filtering, searching, and CRUD operations.
@Observable
final class NotesViewModel {

    // MARK: - State

    var allNotes: [Note] = []
    var filteredNotes: [Note] = []
    var selectedCategory: NoteCategory?
    var isSearching: Bool = false
    var searchQuery: String = ""

    // MARK: - Private

    private let memPalace = MemPalaceManager.shared

    // MARK: - Load

    func loadNotes() {
        allNotes = memPalace.getAllNotes()
        applyFilter()
    }

    // MARK: - Filter

    func filterByCategory(_ category: NoteCategory?) {
        selectedCategory = category
        applyFilter()
    }

    private func applyFilter() {
        if let category = selectedCategory {
            filteredNotes = allNotes.filter { $0.category == category }
        } else {
            filteredNotes = allNotes
        }
    }

    // MARK: - Search

    func search(query: String) async {
        searchQuery = query

        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            loadNotes()
            return
        }

        isSearching = true
        let results = await memPalace.findNotes(
            query: query,
            category: selectedCategory
        )

        filteredNotes = results
        isSearching = false
    }

    // MARK: - CRUD

    func deleteNote(id: String) {
        memPalace.deleteNote(id: id)
        loadNotes()
    }

    // MARK: - Stats

    var noteCountByCategory: [NoteCategory: Int] {
        var counts: [NoteCategory: Int] = [:]
        for note in allNotes {
            counts[note.category, default: 0] += 1
        }
        return counts
    }
}

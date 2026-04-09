import SwiftUI

// MARK: - Notes View (Inbox)

/// Displays all captured voice notes with category filtering and search.
struct NotesView: View {
    @State private var viewModel = NotesViewModel()
    @State private var searchText: String = ""
    @State private var selectedCategory: NoteCategory?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Category filter chips
                categoryChips

                // Notes list
                if viewModel.filteredNotes.isEmpty {
                    emptyState
                } else {
                    notesList
                }
            }
            .navigationTitle("Notes")
            .searchable(text: $searchText, prompt: "Search notes...")
            .onChange(of: searchText) { _, newValue in
                Task {
                    await viewModel.search(query: newValue)
                }
            }
            .onChange(of: selectedCategory) { _, newValue in
                viewModel.filterByCategory(newValue)
            }
            .onAppear {
                viewModel.loadNotes()
            }
        }
    }

    // MARK: - Category Chips

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                CategoryChip(
                    title: "All",
                    icon: "tray.full",
                    isSelected: selectedCategory == nil,
                    color: .accentColor
                ) {
                    selectedCategory = nil
                }

                ForEach(NoteCategory.allCases) { category in
                    CategoryChip(
                        title: category.displayName,
                        icon: category.icon,
                        isSelected: selectedCategory == category,
                        color: categoryColor(category)
                    ) {
                        selectedCategory = category
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Notes List

    private var notesList: some View {
        List {
            ForEach(viewModel.filteredNotes) { note in
                NavigationLink(destination: NoteDetailView(note: note)) {
                    NoteRow(note: note)
                }
            }
            .onDelete { indices in
                for index in indices {
                    let note = viewModel.filteredNotes[index]
                    viewModel.deleteNote(id: note.id)
                }
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "note.text")
                .font(.system(size: 60))
                .foregroundStyle(.tertiary)
            Text("No Notes Yet")
                .font(.title2)
                .fontWeight(.semibold)
            Text("Tap the mic on the Home tab to capture your first voice note")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }

    // MARK: - Helpers

    private func categoryColor(_ category: NoteCategory) -> Color {
        switch category {
        case .note: return .blue
        case .task: return .green
        case .reminder: return .orange
        case .action: return .purple
        case .contact: return .pink
        case .idea: return .yellow
        case .query: return .teal
        }
    }
}

// MARK: - Note Row

struct NoteRow: View {
    let note: Note

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: note.category.icon)
                    .font(.caption)
                    .foregroundStyle(categoryColor)
                Text(note.category.displayName)
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(categoryColor)

                Spacer()

                Text(DateHelpers.formatRelativeDate(note.timestamp))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Text(note.content)
                .font(.body)
                .lineLimit(2)
                .foregroundStyle(.primary)

            if !note.tags.isEmpty {
                HStack(spacing: 4) {
                    ForEach(note.tags.prefix(3), id: \.self) { tag in
                        Text(tag)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(.quaternary, in: Capsule())
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var categoryColor: Color {
        switch note.category {
        case .note: return .blue
        case .task: return .green
        case .reminder: return .orange
        case .action: return .purple
        case .contact: return .pink
        case .idea: return .yellow
        case .query: return .teal
        }
    }
}

#Preview {
    NotesView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}

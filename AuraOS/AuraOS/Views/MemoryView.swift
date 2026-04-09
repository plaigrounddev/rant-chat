import SwiftUI

// MARK: - Memory View

/// Natural language search across the MemPalace persistent memory system.
struct MemoryView: View {
    @State private var viewModel = MemoryViewModel()
    @State private var searchText: String = ""
    @State private var selectedType: MemoryType?
    @State private var showAddMemory = false
    @State private var newMemoryContent = ""
    @State private var newMemoryType: MemoryType = .semantic

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Type filter
                typeFilter

                if viewModel.searchResults.isEmpty && searchText.isEmpty {
                    // Show all memories
                    if viewModel.allMemories.isEmpty {
                        emptyState
                    } else {
                        memoryList(viewModel.allMemories)
                    }
                } else if viewModel.searchResults.isEmpty {
                    noResultsState
                } else {
                    memoryList(viewModel.searchResults)
                }
            }
            .navigationTitle("Memory")
            .searchable(text: $searchText, prompt: "Ask your memory anything...")
            .onChange(of: searchText) { _, newValue in
                Task {
                    await viewModel.search(query: newValue)
                }
            }
            .onChange(of: selectedType) { _, newValue in
                viewModel.filterByType(newValue)
            }
            .onAppear {
                viewModel.loadMemories()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAddMemory = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                    }
                }
            }
            .sheet(isPresented: $showAddMemory) {
                addMemorySheet
            }
        }
    }

    // MARK: - Type Filter

    private var typeFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                CategoryChip(
                    title: "All",
                    icon: "tray.full",
                    isSelected: selectedType == nil,
                    color: .accentColor
                ) {
                    selectedType = nil
                }

                ForEach(MemoryType.allCases) { type in
                    CategoryChip(
                        title: type.displayName,
                        icon: type.icon,
                        isSelected: selectedType == type,
                        color: typeColor(type)
                    ) {
                        selectedType = type
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    // MARK: - Memory List

    private func memoryList(_ memories: [Memory]) -> some View {
        List {
            ForEach(memories) { memory in
                MemoryCard(memory: memory)
            }
            .onDelete { indices in
                let displayedMemories = memories
                for index in indices {
                    viewModel.deleteMemory(id: displayedMemories[index].id)
                }
            }
        }
        .listStyle(.plain)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "brain.head.profile")
                .font(.system(size: 60))
                .foregroundStyle(.tertiary)
            Text("No Memories Yet")
                .font(.title2)
                .fontWeight(.semibold)
            Text("As you use AuraOS, memories are automatically created from your conversations, notes, and commands.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
    }

    private var noResultsState: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(.tertiary)
            Text("No matching memories")
                .font(.title3)
                .foregroundStyle(.secondary)
            Text("Try a different search query")
                .font(.body)
                .foregroundStyle(.tertiary)
            Spacer()
        }
    }

    // MARK: - Add Memory Sheet

    private var addMemorySheet: some View {
        NavigationStack {
            Form {
                Section("Memory Content") {
                    TextEditor(text: $newMemoryContent)
                        .frame(minHeight: 100)
                }

                Section("Memory Type") {
                    Picker("Type", selection: $newMemoryType) {
                        ForEach(MemoryType.allCases) { type in
                            Label(type.displayName, systemImage: type.icon)
                                .tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("Add Memory")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddMemory = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await viewModel.addMemory(
                                content: newMemoryContent,
                                type: newMemoryType
                            )
                            newMemoryContent = ""
                            showAddMemory = false
                        }
                    }
                    .disabled(newMemoryContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Helpers

    private func typeColor(_ type: MemoryType) -> Color {
        switch type {
        case .episodic: return .blue
        case .semantic: return .purple
        case .procedural: return .green
        }
    }
}

#Preview {
    MemoryView()
        .environment(NetworkMonitor.shared)
        .environment(MemPalaceManager.shared)
        .environment(ModelDownloadManager.shared)
}

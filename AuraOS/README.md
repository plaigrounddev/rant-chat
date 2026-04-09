# AuraOS — Native iOS AI Operating System Layer

A native iOS app that acts as a personal AI OS layer — fully functional offline, with persistent memory, full system-level device control, and an online agent mode that executes actions on your behalf via Convex.

**Core differentiator:** most AI agents die without internet. This one doesn't.

---

## Architecture

```
┌────────────────────── AuraOS (iOS) ──────────────────────┐
│                                                          │
│  ┌─ Voice Pipeline ──────────────────────────────────┐   │
│  │  Mic → AVAudioRecorder → whisper.cpp → Gemma 4   │   │
│  │       (16kHz WAV)        (transcribe)  (intent)   │   │
│  └───────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌─ Intent Router ──────┴──────────────────────────┐     │
│  │  note → MemPalace      command → SystemControl  │     │
│  │  task → Calendar        action → ActionQueue     │     │
│  │  idea → MemPalace      query → Memory Search    │     │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─ MemPalace (SQLite + Vector Search) ─────────────┐   │
│  │  memories (episodic / semantic / procedural)      │   │
│  │  notes (voice-captured, auto-categorized)         │   │
│  │  action_queue (pending online actions)            │   │
│  │  settings (user preferences)                      │   │
│  └───────────────────────────────────────────────────┘   │
│                         │                                │
│  ┌─ Online Mode ────────┴──────────────────────────┐     │
│  │  NWPathMonitor → ConvexSyncService              │     │
│  │  Sync memories + notes → Convex cloud           │     │
│  │  Flush action queue → Convex actions             │     │
│  │  (Gmail, Slack, Calendar via Composio)           │     │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────── Convex Cloud Backend ──────────────┐
│  aura.ts — mutations & actions                │
│  aura_memories, aura_notes, aura_actions      │
│  Composio integrations (Gmail, Slack, etc.)   │
└───────────────────────────────────────────────┘
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| AI Engine | Gemma 4 2B (GGUF, on-device) | Offline inference, intent parsing, Q&A |
| Transcription | whisper.cpp (on-device) | Offline speech-to-text |
| Local Database | SQLite.swift | Offline-first persistent storage |
| Vector Search | In-memory cosine similarity | Semantic memory retrieval |
| Cloud Backend | Convex | Real-time sync, action execution |
| Network | NWPathMonitor | Native offline/online detection |
| UI Framework | SwiftUI (iOS 17+) | Modern declarative UI |
| Architecture | MVVM + @Observable | Clean separation of concerns |

## Features

### Offline Voice Capture + Auto-Categorization
- Tap mic → record → whisper.cpp transcribes → Gemma 4 classifies
- Categories: note, task, reminder, action, contact, idea, query
- All processing happens on-device with zero internet

### Full iOS System Control
- Natural language commands mapped to iOS APIs:
  - "Turn on flashlight" → `AVCaptureDevice.torchMode`
  - "Set a reminder for 9am" → `EKReminder`
  - "What's on my calendar?" → `EKEventStore.events(matching:)`
  - "Call Mom" → `UIApplication.open(tel://)`
  - "Take a photo" → Camera view
  - "Set brightness to 50%" → `UIScreen.main.brightness`
  - "Toggle do not disturb" → Focus settings

### Persistent Memory (MemPalace)
- Remembers names, preferences, past conversations, patterns
- Queryable via natural language: "What did I say about the portal?"
- Memory types: episodic (events), semantic (facts), procedural (habits)
- Vector embeddings for semantic search
- Syncs to Convex cloud when online

### Online Agent Mode
- Monitors network with `NWPathMonitor`
- Queues actions offline, flushes when connected
- Executes via Convex actions (Gmail, Slack, Calendar)
- "Pending Actions" tray with confirm/skip per item

### Smart Note Inbox
- All captured notes in a unified inbox
- Auto-tagged by category, date, context
- Searchable via natural language
- Filter by category chips

---

## Requirements

| Requirement | Minimum |
|------------|---------|
| macOS | 14.0 (Sonoma) |
| Xcode | 16.0+ |
| iOS Target | 17.0+ |
| Swift | 5.9+ |
| Device | iPhone with A14+ (for on-device inference) |
| Storage | ~2GB for AI models |

## Setup

### 1. Clone and Open

```bash
git clone <repo-url>
cd AuraOS
open Package.swift  # Opens in Xcode via SPM
```

Or create a new Xcode project and add as a Swift Package:
- File → Add Packages → Add Local Package → select the AuraOS folder

### 2. Configure Xcode Project

Since this project uses SPM with `Package.swift`, you may need to:

1. Create a new Xcode iOS App project named "AuraOS"
2. Copy the source files from `AuraOS/` into the project
3. Add SPM dependencies:
   - `https://github.com/mattt/llama.swift.git` (version 2.8628.0+)
   - `https://github.com/ggml-org/whisper.cpp.git` (version 1.5.0+)
   - `https://github.com/stephencelis/SQLite.swift.git` (version 0.16.0+)
4. Copy `Info.plist` to the project and ensure it's set as the Info.plist file in Build Settings

### 3. Download AI Models

On first launch, the app will prompt you to download:

| Model | Size | Source |
|-------|------|--------|
| Gemma 4 2B (Q4_K_M) | ~1.5 GB | [HuggingFace](https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF) |
| Whisper small.en | ~150 MB | [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp) |

The app downloads these automatically via the Onboarding flow. Models are stored in the app's Documents directory.

**Manual download** (if you prefer to pre-load):
```bash
# Gemma 4
curl -L https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-2b-it-Q4_K_M.gguf -o gemma-4-2b-it-q4_k_m.gguf

# Whisper
curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin -o ggml-small.en.bin
```

Transfer to the app's Documents/Models directory via Finder or the Files app.

### 4. Configure Convex (Optional — for cloud sync)

If you want online agent mode with cloud sync:

1. Set up a [Convex](https://convex.dev) deployment
2. Deploy the schema from `convex/auraSchema.ts`
3. Deploy the functions from `convex/aura.ts`
4. In AuraOS Settings, enter your Convex deployment URL and token

### 5. Build and Run

- Select your target device (iPhone with A14+ recommended)
- Build and run (⌘R)
- Grant permissions when prompted
- Download models via the Onboarding flow
- Tap the mic and start talking!

---

## Project Structure

```
AuraOS/
├── Package.swift              # SPM dependencies
├── AuraOS/
│   ├── AuraOSApp.swift        # App entry point
│   ├── Info.plist             # Permissions & config
│   ├── Assets.xcassets/       # Colors, icons
│   │
│   ├── Models/
│   │   └── CoreModels.swift   # Memory, Note, Action, Intent types
│   │
│   ├── Services/
│   │   ├── MemPalaceDatabase.swift      # SQLite CRUD + vector search
│   │   ├── MemPalaceManager.swift       # High-level memory API
│   │   ├── LLMService.swift             # Gemma 4 inference
│   │   ├── IntentParser.swift           # Voice → structured intent
│   │   ├── ModelDownloadManager.swift   # First-launch model download
│   │   ├── AudioRecordingService.swift  # AVAudioRecorder wrapper
│   │   ├── WhisperService.swift         # On-device transcription
│   │   ├── VoiceCapturePipeline.swift   # Full voice-to-action flow
│   │   ├── SystemControlService.swift   # iOS API command execution
│   │   ├── PermissionManager.swift      # Centralized permissions
│   │   ├── NetworkMonitor.swift         # NWPathMonitor wrapper
│   │   ├── ConvexSyncService.swift      # Convex cloud sync
│   │   └── ActionQueueManager.swift     # Offline action queue
│   │
│   ├── Views/
│   │   ├── ContentView.swift            # Tab navigation
│   │   ├── HomeView.swift               # Mic button + stats
│   │   ├── NotesView.swift              # Note inbox
│   │   ├── NoteDetailView.swift         # Note detail
│   │   ├── MemoryView.swift             # Memory search
│   │   ├── ActionsView.swift            # Pending actions tray
│   │   ├── SettingsView.swift           # All settings
│   │   ├── OnboardingView.swift         # First-launch setup
│   │   └── Components/
│   │       ├── PulsingMicButton.swift   # Animated mic button
│   │       ├── StatusBadge.swift        # Online/offline badge
│   │       ├── CategoryChip.swift       # Filter chip
│   │       ├── WaveformView.swift       # Audio visualizer
│   │       ├── ActionCard.swift         # Pending action card
│   │       └── MemoryCard.swift         # Memory result card
│   │
│   ├── ViewModels/
│   │   ├── HomeViewModel.swift
│   │   ├── NotesViewModel.swift
│   │   ├── MemoryViewModel.swift
│   │   └── ActionsViewModel.swift
│   │
│   ├── Utilities/
│   │   ├── DateHelpers.swift            # Date formatting + NL parsing
│   │   └── JSONHelpers.swift            # Safe JSON extraction
│   │
│   └── Resources/
│       └── Prompts.swift                # LLM prompt templates
│
├── AuraOSTests/
│   ├── MemPalaceDatabaseTests.swift
│   ├── IntentParserTests.swift
│   ├── DateHelpersTests.swift
│   └── JSONHelpersTests.swift
│
└── Convex Backend (in /convex/)
    ├── aura.ts                          # Mutations, actions, queries
    └── auraSchema.ts                    # Table definitions
```

## Running Tests

```bash
# In Xcode
⌘U  # Run all tests

# Or via command line
xcodebuild test -scheme AuraOS -destination 'platform=iOS Simulator,name=iPhone 16'
```

Tests cover:
- **MemPalaceDatabase**: SQLite CRUD, vector search, settings, sync tracking
- **IntentParser**: Rule-based intent classification, entity extraction, edge cases
- **DateHelpers**: Relative formatting, duration formatting, natural language date parsing
- **JSONHelpers**: JSON extraction from LLM output, markdown fences, encoding/decoding

## Known Limitations

1. **Model size**: Gemma 4 2B requires ~1.5GB storage. The 4B variant requires ~3GB but offers better quality.
2. **Inference speed**: On-device inference is slower than cloud APIs. Expect 1-3 seconds for intent parsing on A14+ chips.
3. **DND toggle**: Direct Focus mode toggling is restricted by iOS. The app opens Focus settings instead.
4. **Online agent actions**: MVP logs actions and returns success. Production integration with Gmail/Slack/Calendar via Composio is stubbed in `convex/aura.ts`.
5. **Volume control**: iOS does not expose programmatic volume control. Users must use physical buttons.
6. **Embedding quality**: On-device embeddings from Gemma 4 2B are lower quality than dedicated embedding models. Consider adding MiniLM GGUF for better vector search.

## Roadmap

- [ ] Always-on wake word detection (currently tap-to-record)
- [ ] iCloud sync for MemPalace (alternative to Convex)
- [ ] Widget for quick voice capture
- [ ] Siri Shortcuts integration for deeper OS hooks
- [ ] Apple Watch companion app
- [ ] MiniLM embeddings model for better vector search
- [ ] Full Composio integration for Gmail, Slack, Calendar actions
- [ ] Conversation mode (multi-turn chat with memory context)

## License

Private — not for redistribution.

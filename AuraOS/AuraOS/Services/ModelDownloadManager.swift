import Foundation
import Observation

// MARK: - Model Download Manager

/// Manages downloading and validating AI models (Gemma 4 + Whisper) on first launch.
/// Models are stored in the app's Documents/Models directory.
@Observable
final class ModelDownloadManager: NSObject {

    // MARK: - Singleton

    static let shared = ModelDownloadManager()

    // MARK: - Model Definitions

    struct ModelInfo {
        let name: String
        let fileName: String
        let downloadURL: URL
        let expectedSizeBytes: Int64  // Approximate expected size for validation
        let description: String
    }

    static let gemmaModel = ModelInfo(
        name: "Gemma 4 2B (Q4_K_M)",
        fileName: "gemma-4-2b-it-q4_k_m.gguf",
        downloadURL: URL(string: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-2b-it-Q4_K_M.gguf")!,
        expectedSizeBytes: 1_500_000_000,  // ~1.5GB
        description: "On-device AI for intent parsing, categorization, and Q&A"
    )

    static let whisperModel = ModelInfo(
        name: "Whisper Small (English)",
        fileName: "ggml-small.en.bin",
        downloadURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin")!,
        expectedSizeBytes: 150_000_000,  // ~150MB
        description: "On-device speech-to-text transcription"
    )

    static let allModels: [ModelInfo] = [gemmaModel, whisperModel]

    // MARK: - State

    /// Overall progress (0.0 to 1.0) across all models
    var overallProgress: Double = 0.0

    /// Per-model download progress
    var modelProgress: [String: Double] = [:]

    /// Currently downloading model name
    var currentModelName: String?

    /// Whether all required models are downloaded and ready
    var isReady: Bool = false

    /// Error message if download fails
    var errorMessage: String?

    /// Whether a download is in progress
    var isDownloading: Bool = false

    // MARK: - Private

    private var downloadTask: URLSessionDownloadTask?
    private var session: URLSession?
    private var currentCompletion: ((Result<URL, Error>) -> Void)?
    private var currentModelFileName: String?

    // MARK: - Init

    private override init() {
        super.init()
        checkModelsReady()
    }

    // MARK: - Public API

    /// Check if all required models are already downloaded
    func checkModelsReady() {
        isReady = Self.allModels.allSatisfy { model in
            let path = LLMService.modelsDirectory.appendingPathComponent(model.fileName)
            return FileManager.default.fileExists(atPath: path.path)
        }

        // Update per-model progress for already downloaded models
        for model in Self.allModels {
            let path = LLMService.modelsDirectory.appendingPathComponent(model.fileName)
            if FileManager.default.fileExists(atPath: path.path) {
                modelProgress[model.fileName] = 1.0
            }
        }

        updateOverallProgress()
    }

    /// Download all missing models
    func downloadAllModels() async throws {
        guard !isDownloading else { return }
        isDownloading = true
        errorMessage = nil

        do {
            for model in Self.allModels {
                let destinationPath = LLMService.modelsDirectory.appendingPathComponent(model.fileName)

                // Skip if already downloaded
                if FileManager.default.fileExists(atPath: destinationPath.path) {
                    modelProgress[model.fileName] = 1.0
                    updateOverallProgress()
                    continue
                }

                currentModelName = model.name

                try await downloadModel(model, to: destinationPath)

                modelProgress[model.fileName] = 1.0
                updateOverallProgress()
            }

            currentModelName = nil
            isDownloading = false
            checkModelsReady()

        } catch {
            isDownloading = false
            errorMessage = "Download failed: \(error.localizedDescription)"
            throw error
        }
    }

    /// Cancel any in-progress download
    func cancelDownload() {
        downloadTask?.cancel()
        downloadTask = nil
        isDownloading = false
        currentModelName = nil
    }

    /// Delete all downloaded models
    func deleteAllModels() {
        for model in Self.allModels {
            let path = LLMService.modelsDirectory.appendingPathComponent(model.fileName)
            try? FileManager.default.removeItem(at: path)
            modelProgress[model.fileName] = 0.0
        }
        isReady = false
        updateOverallProgress()
    }

    /// Get total download size for all missing models
    var totalDownloadSizeBytes: Int64 {
        Self.allModels.reduce(0) { total, model in
            let path = LLMService.modelsDirectory.appendingPathComponent(model.fileName)
            if FileManager.default.fileExists(atPath: path.path) {
                return total
            }
            return total + model.expectedSizeBytes
        }
    }

    /// Human-readable total download size
    var totalDownloadSizeFormatted: String {
        ByteCountFormatter.string(fromByteCount: totalDownloadSizeBytes, countStyle: .file)
    }

    /// Get status for each model
    var modelStatuses: [(ModelInfo, Bool)] {
        Self.allModels.map { model in
            let path = LLMService.modelsDirectory.appendingPathComponent(model.fileName)
            let exists = FileManager.default.fileExists(atPath: path.path)
            return (model, exists)
        }
    }

    // MARK: - Private Download

    private func downloadModel(_ model: ModelInfo, to destination: URL) async throws {
        return try await withCheckedThrowingContinuation { continuation in
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 300  // 5 min timeout
            config.timeoutIntervalForResource = 3600  // 1 hour max

            currentModelFileName = model.fileName

            // Create delegate-based session for progress tracking
            self.currentCompletion = { result in
                switch result {
                case .success(let tempURL):
                    do {
                        // Move downloaded file to destination
                        if FileManager.default.fileExists(atPath: destination.path) {
                            try FileManager.default.removeItem(at: destination)
                        }
                        try FileManager.default.moveItem(at: tempURL, to: destination)

                        // Validate file size (basic integrity check)
                        let attrs = try FileManager.default.attributesOfItem(atPath: destination.path)
                        let fileSize = attrs[.size] as? Int64 ?? 0
                        let minExpected = model.expectedSizeBytes / 2  // Allow some variance

                        if fileSize < minExpected {
                            try FileManager.default.removeItem(at: destination)
                            continuation.resume(throwing: ModelDownloadError.fileTooSmall(
                                expected: model.expectedSizeBytes,
                                actual: fileSize
                            ))
                        } else {
                            continuation.resume()
                        }
                    } catch {
                        continuation.resume(throwing: error)
                    }

                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }

            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            self.session = session

            let task = session.downloadTask(with: model.downloadURL)
            self.downloadTask = task
            task.resume()
        }
    }

    private func updateOverallProgress() {
        let totalModels = Double(Self.allModels.count)
        let completedProgress = Self.allModels.reduce(0.0) { sum, model in
            sum + (modelProgress[model.fileName] ?? 0.0)
        }
        overallProgress = completedProgress / totalModels
    }
}

// MARK: - URLSession Delegate (Progress Tracking)

extension ModelDownloadManager: URLSessionDownloadDelegate {

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        currentCompletion?(.success(location))
        currentCompletion = nil
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let progress: Double
        if totalBytesExpectedToWrite > 0 {
            progress = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
        } else {
            // Estimate based on expected size
            let model = Self.allModels.first { $0.fileName == currentModelFileName }
            let expected = model?.expectedSizeBytes ?? totalBytesWritten
            progress = min(Double(totalBytesWritten) / Double(expected), 0.99)
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let fileName = self.currentModelFileName else { return }
            self.modelProgress[fileName] = progress
            self.updateOverallProgress()
        }
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didCompleteWithError error: Error?
    ) {
        if let error {
            currentCompletion?(.failure(error))
            currentCompletion = nil
        }
    }
}

// MARK: - Errors

enum ModelDownloadError: Error, LocalizedError {
    case fileTooSmall(expected: Int64, actual: Int64)
    case downloadCancelled
    case networkUnavailable

    var errorDescription: String? {
        switch self {
        case .fileTooSmall(let expected, let actual):
            let expectedStr = ByteCountFormatter.string(fromByteCount: expected, countStyle: .file)
            let actualStr = ByteCountFormatter.string(fromByteCount: actual, countStyle: .file)
            return "Downloaded file is too small (\(actualStr) vs expected ~\(expectedStr)). The file may be corrupted."
        case .downloadCancelled:
            return "Download was cancelled"
        case .networkUnavailable:
            return "No internet connection available for model download"
        }
    }
}

import Foundation
import Observation
import llama

// MARK: - LLM Service (On-Device Gemma 4 via llama.cpp)

/// Manages the on-device Gemma 4 model lifecycle and inference.
/// Actor-isolated for thread safety — all inference runs off the main thread.
@Observable
final class LLMService {

    // MARK: - Singleton

    static let shared = LLMService()

    // MARK: - State

    private(set) var isLoaded: Bool = false
    private(set) var isGenerating: Bool = false
    private(set) var loadError: String?

    // MARK: - Private

    private var model: OpaquePointer?    // llama_model *
    private var context: OpaquePointer?  // llama_context *
    private let inferenceQueue = DispatchQueue(label: "dev.auraos.llm", qos: .userInitiated)

    // MARK: - Configuration

    struct Config {
        var contextSize: Int32 = 4096
        var batchSize: Int32 = 512
        var threads: Int32 = 4
        var gpuLayers: Int32 = 99  // Offload as many layers as possible to Metal
        var temperature: Float = 0.3
        var topP: Float = 0.9
        var topK: Int32 = 40
        var repeatPenalty: Float = 1.1
        var maxTokens: Int32 = 512
    }

    var config = Config()

    // MARK: - Init

    private init() {
        llama_backend_init()
    }

    deinit {
        unloadModel()
        llama_backend_free()
    }

    // MARK: - Model Management

    /// Load a GGUF model from the given file path
    func loadModel(path: String) async throws {
        guard !isLoaded else { return }

        return try await withCheckedThrowingContinuation { continuation in
            inferenceQueue.async { [weak self] in
                guard let self else {
                    continuation.resume(throwing: LLMError.serviceUnavailable)
                    return
                }

                // Model params
                var modelParams = llama_model_default_params()
                modelParams.n_gpu_layers = self.config.gpuLayers

                guard let loadedModel = llama_model_load_from_file(path, modelParams) else {
                    let error = LLMError.modelLoadFailed(path: path)
                    DispatchQueue.main.async {
                        self.loadError = error.localizedDescription
                    }
                    continuation.resume(throwing: error)
                    return
                }

                // Context params
                var ctxParams = llama_context_default_params()
                ctxParams.n_ctx = UInt32(self.config.contextSize)
                ctxParams.n_batch = UInt32(self.config.batchSize)
                ctxParams.n_threads = UInt32(self.config.threads)
                ctxParams.n_threads_batch = UInt32(self.config.threads)
                ctxParams.embeddings = true

                guard let ctx = llama_init_from_model(loadedModel, ctxParams) else {
                    llama_model_free(loadedModel)
                    let error = LLMError.contextCreationFailed
                    DispatchQueue.main.async {
                        self.loadError = error.localizedDescription
                    }
                    continuation.resume(throwing: error)
                    return
                }

                self.model = loadedModel
                self.context = ctx

                DispatchQueue.main.async {
                    self.isLoaded = true
                    self.loadError = nil
                }

                continuation.resume()
            }
        }
    }

    /// Unload the current model and free resources
    func unloadModel() {
        if let context {
            llama_free(context)
        }
        if let model {
            llama_model_free(model)
        }
        self.context = nil
        self.model = nil
        isLoaded = false
    }

    // MARK: - Text Generation

    /// Generate text from a prompt (streaming via AsyncStream)
    func generate(prompt: String, maxTokens: Int32? = nil, temperature: Float? = nil) -> AsyncStream<String> {
        AsyncStream { continuation in
            inferenceQueue.async { [weak self] in
                guard let self, let model = self.model, let context = self.context else {
                    continuation.finish()
                    return
                }

                DispatchQueue.main.async { self.isGenerating = true }

                let maxTok = maxTokens ?? self.config.maxTokens
                let temp = temperature ?? self.config.temperature

                // Tokenize the prompt using Gemma chat template
                let formattedPrompt = self.formatGemmaPrompt(prompt)
                var tokens = self.tokenize(text: formattedPrompt, model: model)

                // Clear KV cache
                llama_kv_cache_clear(context)

                // Create batch and process prompt tokens
                var batch = llama_batch_init(Int32(tokens.count), 0, 1)

                for (i, token) in tokens.enumerated() {
                    llama_batch_add(&batch, token, Int32(i), [0], i == tokens.count - 1)
                }

                if llama_decode(context, batch) != 0 {
                    llama_batch_free(batch)
                    DispatchQueue.main.async { self.isGenerating = false }
                    continuation.finish()
                    return
                }

                llama_batch_free(batch)

                // Generate tokens one at a time
                var generatedCount: Int32 = 0
                var lastToken: llama_token = 0

                while generatedCount < maxTok {
                    let vocabSize = llama_n_vocab(model)
                    let logits = llama_get_logits_ith(context, -1)

                    // Sample with temperature
                    var candidates: [llama_token_data] = []
                    for i in 0..<vocabSize {
                        candidates.append(llama_token_data(id: i, logit: logits![Int(i)], p: 0))
                    }

                    var candidatesArray = llama_token_data_array(
                        data: &candidates,
                        size: candidates.count,
                        selected: -1,
                        sorted: false
                    )

                    llama_sample_temp(context, &candidatesArray, temp)
                    llama_sample_top_p(context, &candidatesArray, self.config.topP, 1)
                    llama_sample_top_k(context, &candidatesArray, self.config.topK, 1)

                    let newToken = llama_sample_token(context, &candidatesArray)

                    // Check for end of generation
                    if llama_token_is_eog(model, newToken) {
                        break
                    }

                    // Convert token to text
                    let tokenText = self.tokenToString(token: newToken, model: model)
                    continuation.yield(tokenText)

                    // Prepare next batch
                    var nextBatch = llama_batch_init(1, 0, 1)
                    llama_batch_add(&nextBatch, newToken, Int32(tokens.count) + generatedCount, [0], true)

                    if llama_decode(context, nextBatch) != 0 {
                        llama_batch_free(nextBatch)
                        break
                    }

                    llama_batch_free(nextBatch)

                    lastToken = newToken
                    generatedCount += 1
                }

                DispatchQueue.main.async { self.isGenerating = false }
                continuation.finish()
            }
        }
    }

    /// Generate text synchronously (collects all tokens)
    func generateSync(prompt: String, maxTokens: Int32? = nil, temperature: Float? = nil) async -> String {
        var result = ""
        for await token in generate(prompt: prompt, maxTokens: maxTokens, temperature: temperature) {
            result += token
        }
        return result
    }

    // MARK: - Embeddings

    /// Get embedding vector for text (uses model's hidden state)
    func getEmbedding(text: String) async -> [Float]? {
        guard let model, let context else { return nil }

        return await withCheckedContinuation { continuation in
            inferenceQueue.async { [weak self] in
                guard let self else {
                    continuation.resume(returning: nil)
                    return
                }

                let tokens = self.tokenize(text: text, model: model)
                guard !tokens.isEmpty else {
                    continuation.resume(returning: nil)
                    return
                }

                // Process tokens through the model
                llama_kv_cache_clear(context)
                var batch = llama_batch_init(Int32(tokens.count), 0, 1)

                for (i, token) in tokens.enumerated() {
                    llama_batch_add(&batch, token, Int32(i), [0], i == tokens.count - 1)
                }

                if llama_decode(context, batch) != 0 {
                    llama_batch_free(batch)
                    continuation.resume(returning: nil)
                    return
                }

                llama_batch_free(batch)

                // Extract embedding from the last token's logits
                // (Simplified — real implementation might use a dedicated embedding model)
                let embeddingSize = Int(llama_n_embd(model))
                let embeddings = llama_get_embeddings(context)

                if let embeddings {
                    let embedding = Array(UnsafeBufferPointer(start: embeddings, count: embeddingSize))
                    // Normalize the embedding vector
                    let norm = sqrt(embedding.reduce(0) { $0 + $1 * $1 })
                    let normalized = norm > 0 ? embedding.map { $0 / norm } : embedding
                    continuation.resume(returning: normalized)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }

    // MARK: - Helpers

    /// Format prompt using Gemma chat template
    private func formatGemmaPrompt(_ userMessage: String) -> String {
        return "<start_of_turn>user\n\(userMessage)<end_of_turn>\n<start_of_turn>model\n"
    }

    /// Format a system + user prompt using Gemma chat template
    func formatPrompt(system: String, user: String) -> String {
        return """
        <start_of_turn>user
        \(system)

        \(user)<end_of_turn>
        <start_of_turn>model
        """
    }

    /// Tokenize a string into token IDs
    private func tokenize(text: String, model: OpaquePointer) -> [llama_token] {
        let utf8 = text.utf8CString
        let maxTokens = Int32(utf8.count) + 16
        var tokens = [llama_token](repeating: 0, count: Int(maxTokens))

        let tokenCount = llama_tokenize(model, text, Int32(text.utf8.count), &tokens, maxTokens, true, true)

        if tokenCount < 0 {
            return []
        }

        return Array(tokens.prefix(Int(tokenCount)))
    }

    /// Convert a single token ID back to a string
    private func tokenToString(token: llama_token, model: OpaquePointer) -> String {
        var buffer = [CChar](repeating: 0, count: 256)
        let length = llama_token_to_piece(model, token, &buffer, 256, 0, true)

        if length > 0 {
            return String(cString: Array(buffer.prefix(Int(length))) + [0])
        }
        return ""
    }

    // MARK: - Model Info

    /// Get the path where models should be stored
    static var modelsDirectory: URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let modelsDir = documentsPath.appendingPathComponent("Models", isDirectory: true)
        try? FileManager.default.createDirectory(at: modelsDir, withIntermediateDirectories: true)
        return modelsDir
    }

    /// Check if the Gemma model file exists
    static var gemmaModelPath: URL {
        modelsDirectory.appendingPathComponent("gemma-4-2b-it-q4_k_m.gguf")
    }

    static var isGemmaModelDownloaded: Bool {
        FileManager.default.fileExists(atPath: gemmaModelPath.path)
    }
}

// MARK: - Errors

enum LLMError: Error, LocalizedError {
    case modelLoadFailed(path: String)
    case contextCreationFailed
    case serviceUnavailable
    case generationFailed
    case tokenizationFailed

    var errorDescription: String? {
        switch self {
        case .modelLoadFailed(let path):
            return "Failed to load model at: \(path)"
        case .contextCreationFailed:
            return "Failed to create inference context"
        case .serviceUnavailable:
            return "LLM service is not available"
        case .generationFailed:
            return "Text generation failed"
        case .tokenizationFailed:
            return "Failed to tokenize input text"
        }
    }
}

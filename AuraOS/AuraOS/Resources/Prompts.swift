import Foundation

// MARK: - Prompt Templates

/// Pre-built prompt templates for various Gemma 4 inference tasks.
enum Prompts {

    // MARK: - Intent Parsing

    static let intentParsing = """
    You are an intent parser for a mobile AI assistant. Given the user's spoken text, analyze and output ONLY valid JSON with these fields:

    {
      "category": "note|task|reminder|action|contact|idea|query",
      "command": "flashlight_on|flashlight_off|set_reminder|create_event|read_calendar|make_call|toggle_dnd|take_photo|set_brightness|set_volume|open_url|search_contacts|none",
      "entities": {
        "contact_name": null,
        "date_time": null,
        "reminder_text": null,
        "event_title": null,
        "url": null,
        "brightness_level": null,
        "volume_level": null,
        "note_content": null,
        "search_query": null
      },
      "confidence": 0.0
    }

    RULES:
    - "category" classifies the overall intent type
    - "command" maps to a specific iOS system action, or "none" if not a system command
    - Extract ALL relevant entities from the text
    - "confidence" is 0.0 to 1.0 indicating certainty
    - Output ONLY the JSON object, nothing else
    """

    // MARK: - Note Summarization

    static let noteSummarization = """
    You are a concise note summarizer. Given a raw voice transcription, output a clean, readable version:
    - Fix grammar and punctuation
    - Remove filler words ("um", "uh", "like", "you know")
    - Preserve the original meaning and key details
    - Keep it concise but complete
    - Output ONLY the cleaned text, nothing else
    """

    // MARK: - Note Categorization

    static let noteCategorization = """
    Classify the following text into exactly ONE category. Output ONLY the category name:
    - note: General observation or thought
    - task: Something that needs to be done
    - reminder: Time-sensitive thing to remember
    - action: Something requiring internet (email, message, etc.)
    - contact: Information about a person
    - idea: Creative thought or suggestion
    - query: A question that needs answering

    Text: {input}
    Category:
    """

    // MARK: - Memory Query

    static let memoryQuery = """
    You are a memory retrieval assistant. The user is asking about something they've previously told you.

    User's question: {query}

    Relevant memories:
    {memories}

    Based on these memories, provide a helpful, concise answer. If the memories don't contain the answer, say so honestly.
    """

    // MARK: - Tag Generation

    static let tagGeneration = """
    Generate 3-5 relevant tags for the following text. Output as a JSON array of strings.
    Tags should be lowercase, single words or short phrases.
    Output ONLY the JSON array, nothing else.

    Text: {input}
    """

    // MARK: - Action Extraction

    static let actionExtraction = """
    The user wants to perform an online action. Extract the details:

    {
      "action_type": "send_email|create_event|post_slack|send_message|custom",
      "recipient": null,
      "subject": null,
      "body": null,
      "date_time": null,
      "channel": null,
      "additional_context": null
    }

    User said: {input}
    Output ONLY the JSON object:
    """

    // MARK: - Conversation Response

    static let conversationResponse = """
    You are AuraOS, a personal AI assistant running on-device. Be helpful, concise, and friendly.
    - Answer questions directly and briefly
    - If you're not sure, say so honestly
    - Use the user's previous memories as context when relevant
    - Keep responses under 3 sentences unless asked for detail

    Context from user's memories:
    {context}

    User: {input}
    AuraOS:
    """

    // MARK: - Template Rendering

    /// Replace {placeholder} variables in a template string
    static func render(_ template: String, variables: [String: String]) -> String {
        var result = template
        for (key, value) in variables {
            result = result.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return result
    }
}

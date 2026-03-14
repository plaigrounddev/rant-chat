"use client";

/**
 * File Upload Button for Gemini Embedding 2 RAG
 * 
 * Supports uploading images, PDFs, video, and audio files.
 * Files are sent to the /api/embed endpoint which proxies to Convex.
 */

import React, { useRef, useState } from "react";
import { Paperclip, Loader2, Check, X, FileText, Image, Film, Music } from "lucide-react";

// Supported MIME types matching Gemini Embedding 2 capabilities
const ACCEPTED_TYPES = [
    "image/png",
    "image/jpeg",
    "application/pdf",
    "video/mpeg",
    "video/mp4",
    "audio/mp3",
    "audio/wav",
    "audio/mpeg",
    "text/plain",
    "text/markdown",
].join(",");

type UploadStatus = "idle" | "uploading" | "embedding" | "success" | "error";

interface UploadedFile {
    name: string;
    type: string;
    size: number;
    status: UploadStatus;
    error?: string;
}

function getFileIcon(mimeType: string) {
    if (mimeType.startsWith("image/")) return <Image className="w-4 h-4" />;
    if (mimeType.startsWith("video/")) return <Film className="w-4 h-4" />;
    if (mimeType.startsWith("audio/")) return <Music className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface FileUploadButtonProps {
    namespace?: string;
    onUploadComplete?: (file: UploadedFile) => void;
    className?: string;
}

export function FileUploadButton({
    namespace,
    onUploadComplete,
    className = "",
}: FileUploadButtonProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploads, setUploads] = useState<UploadedFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        setIsUploading(true);

        for (const file of Array.from(files)) {
            const uploadFile: UploadedFile = {
                name: file.name,
                type: file.type,
                size: file.size,
                status: "uploading",
            };

            setUploads((prev) => [...prev, uploadFile]);

            try {
                const formData = new FormData();
                formData.append("file", file);
                if (namespace) formData.append("namespace", namespace);

                const response = await fetch("/api/embed", {
                    method: "POST",
                    body: formData,
                });

                const result = await response.json();

                if (!response.ok) {
                    setUploads((prev) =>
                        prev.map((u) =>
                            u.name === file.name && u.status === "uploading"
                                ? { ...u, status: "error" as const, error: result.error }
                                : u
                        )
                    );
                    continue;
                }

                // Update to embedding status
                setUploads((prev) =>
                    prev.map((u) =>
                        u.name === file.name && u.status === "uploading"
                            ? { ...u, status: "embedding" as const }
                            : u
                    )
                );

                // After a short delay, mark as success (embedding happens async on server)
                setTimeout(() => {
                    setUploads((prev) =>
                        prev.map((u) =>
                            u.name === file.name && u.status === "embedding"
                                ? { ...u, status: "success" as const }
                                : u
                        )
                    );
                    onUploadComplete?.({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        status: "success",
                    });
                }, 2000);
            } catch (error) {
                setUploads((prev) =>
                    prev.map((u) =>
                        u.name === file.name && u.status === "uploading"
                            ? { ...u, status: "error" as const, error: "Upload failed" }
                            : u
                    )
                );
            }
        }

        setIsUploading(false);
        // Reset the input
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const clearUpload = (name: string) => {
        setUploads((prev) => prev.filter((u) => u.name !== name));
    };

    const clearAll = () => setUploads([]);

    return (
        <div className={`relative ${className}`}>
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="rag-file-upload"
            />

            {/* Upload button */}
            <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                           bg-white/5 hover:bg-white/10 border border-white/10
                           text-white/70 hover:text-white transition-all duration-200
                           disabled:opacity-50 disabled:cursor-not-allowed"
                title="Upload files for AI knowledge base (images, PDFs, video, audio)"
            >
                {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Paperclip className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Attach</span>
            </button>

            {/* Upload status list */}
            {uploads.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-zinc-900 border border-white/10 
                                rounded-lg shadow-2xl overflow-hidden z-50">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                        <span className="text-xs font-medium text-white/50">
                            Uploads ({uploads.length})
                        </span>
                        <button
                            onClick={clearAll}
                            className="text-xs text-white/30 hover:text-white/60 transition-colors"
                        >
                            Clear all
                        </button>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                        {uploads.map((file, i) => (
                            <div
                                key={`${file.name}-${i}`}
                                className="flex items-center gap-2 px-3 py-2 border-b border-white/5 last:border-0"
                            >
                                <span className="text-white/40">{getFileIcon(file.type)}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-white/80 truncate">{file.name}</p>
                                    <p className="text-[10px] text-white/30">
                                        {formatFileSize(file.size)}
                                        {file.error && (
                                            <span className="text-red-400 ml-1">• {file.error}</span>
                                        )}
                                    </p>
                                </div>
                                <div className="flex-shrink-0">
                                    {file.status === "uploading" && (
                                        <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                                    )}
                                    {file.status === "embedding" && (
                                        <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                                    )}
                                    {file.status === "success" && (
                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    )}
                                    {file.status === "error" && (
                                        <button
                                            onClick={() => clearUpload(file.name)}
                                            className="text-red-400 hover:text-red-300"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

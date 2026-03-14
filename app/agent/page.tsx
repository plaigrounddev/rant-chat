import AgentChat from "./agent-chat";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function AgentPage() {
    return (
        <div className="relative h-screen w-full flex flex-col bg-background">
            <header className="absolute top-0 left-0 w-full z-10 flex items-center gap-4 px-6 py-4 pointer-events-none">
                <Link
                    href="/"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors pointer-events-auto bg-background/50 backdrop-blur-sm px-3 py-1.5 rounded-full border border-border/50 shadow-sm hover:shadow-md hover:bg-background/80"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Link>
            </header>
            <div className="flex-1 overflow-hidden flex bg-muted/20 pt-14">
                <AgentChat />
            </div>
        </div>
    );
}


import { NextResponse } from "next/server";
import { getAllTemplates, getTemplateCategories } from "@/lib/agent/prompt-templates";

/**
 * GET /api/agent/templates
 *
 * Returns all available prompt templates for the agent,
 * grouped by category.
 */
export async function GET() {
    const templates = getAllTemplates();
    const categories = getTemplateCategories();

    return NextResponse.json({
        templates: templates.map((t) => ({
            slug: t.slug,
            name: t.name,
            description: t.description,
            category: t.category,
            icon: t.icon,
        })),
        categories,
    });
}

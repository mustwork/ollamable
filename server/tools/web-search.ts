import { randomUUID } from "node:crypto";
import type { ToolExecutor } from "../tool-executor.js";
import type { MetaEvent } from "../types.js";

export class WebSearchExecutor implements ToolExecutor {
  canHandle(name: string): boolean {
    return name === "web_search";
  }

  async execute(
    _name: string,
    args: Record<string, unknown>,
    emit: (event: MetaEvent) => void
  ): Promise<string> {
    const query = String(args.query ?? "");
    const startTime = Date.now();

    emit({
      id: randomUUID(),
      kind: "search_start",
      title: "Web Search",
      detail: `Searching for: "${query}"`,
      data: { query },
      timestamp: new Date().toISOString(),
    });

    try {
      // Use DuckDuckGo Lite as a simple, no-API-key search source
      const encodedQuery = encodeURIComponent(query);
      const response = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodedQuery}`,
        {
          headers: {
            "User-Agent": "Ollamable/0.1 (educational tool)",
          },
        }
      );

      const html = await response.text();
      const results = extractDuckDuckGoResults(html);
      const durationMs = Date.now() - startTime;

      emit({
        id: randomUUID(),
        kind: "search_result",
        title: "Search Results",
        detail: `Found ${results.length} result(s) in ${durationMs}ms`,
        data: { results, query, durationMs },
        timestamp: new Date().toISOString(),
        durationMs,
      });

      if (results.length === 0) {
        return JSON.stringify({
          query,
          results: [],
          summary: "No results found.",
        });
      }

      return JSON.stringify({ query, results: results.slice(0, 5) });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const message =
        error instanceof Error ? error.message : "Unknown search error";

      emit({
        id: randomUUID(),
        kind: "search_result",
        title: "Search Failed",
        detail: message,
        data: { error: message, query },
        timestamp: new Date().toISOString(),
        durationMs,
      });

      return JSON.stringify({ query, error: message });
    }
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function extractDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // DuckDuckGo Lite returns results in a table with specific patterns.
  // Each result has a link with class "result-link" and a snippet in a <td> with class "result-snippet".
  const linkRegex =
    /<a[^>]+class="result-link"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const links: { url: string; title: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: match[1],
      title: stripHtml(match[2]),
    });
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(stripHtml(match[1]));
  }

  for (let i = 0; i < links.length && i < 5; i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

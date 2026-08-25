/**
 * Project the one enriched `Resource[]` store onto every agent-discovery
 * surface. The whole point of the template lives here: the underlying data is
 * identical; each function just renders it in the convention a given agent or
 * crawler prefers.
 *
 *   renderLlmsTxt        -> /llms.txt          (llms.txt index convention)
 *   renderLlmsFullTxt    -> /llms-full.txt     (full inlined content)
 *   renderIndexJson      -> /index.json        (typed JSON index)
 *   renderResourceMd     -> /<slug>.md         (per-page groundable Markdown)
 *   renderRobotsTxt      -> /robots.txt        (explicit AI-bot directives)
 *   renderWebsiteJsonLd  -> JSON-LD            (schema.org, embedded in HTML)
 *   renderResourceJsonLd -> JSON-LD            (schema.org per page)
 */
import type { Resource, SiteConfig } from "../lib/types";

export interface RenderCtx {
	site: SiteConfig;
	resources: Resource[];
	/** Content-Signal policy value, e.g. "ai-input=yes, search=yes, ai-train=no". */
	contentSignal?: string;
}

export const INDEX_PROTOCOL = "agent-visibility/0.1";

export const AGENT_SKILL_PATH = "/.well-known/agent-skills/agent-visibility/SKILL.md";

/**
 * A small, self-contained Agent Skill. Its digest is calculated at request
 * time so the discovery index always describes the exact bytes served.
 */
export const AGENT_VISIBILITY_SKILL = `---
name: agent-visibility
description: Discover and consume this site's AI-readable content and public content API.
---

# Agent Visibility

Use this skill when you need grounded information published by this site.

1. Read \`/llms.txt\` for the concise content directory.
2. Read \`/llms-full.txt\` when all indexed material fits the task.
3. Fetch \`/{slug}.md\` for a focused, citable page.
4. Use \`/index.json\` or \`/api/resources\` when structured fields are more useful.

Treat canonical URLs in each resource as the human-facing source of record.
`;

/** AI crawlers we explicitly welcome in robots.txt. */
export const KNOWN_AI_AGENTS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-User",
	"PerplexityBot",
	"Google-Extended",
	"Applebot-Extended",
	"Bytespider",
	"CCBot",
];

function mdLink(text: string, href: string): string {
	return `[${text}](${href})`;
}

// ---------------------------------------------------------------------------
// /llms.txt — short Markdown index per the llms.txt convention.
// ---------------------------------------------------------------------------
export function renderLlmsTxt(ctx: RenderCtx): string {
	const { site, resources } = ctx;
	const lines: string[] = [];
	lines.push(`# ${site.name}`);
	lines.push("");
	lines.push(`> ${site.description}`);
	lines.push("");
	lines.push("Other machine-readable surfaces for this site:");
	lines.push(`- ${mdLink("Full content", `${site.origin}/llms-full.txt`)}`);
	lines.push(`- ${mdLink("Typed JSON index", `${site.origin}/index.json`)}`);
	lines.push("");
	lines.push("## Pages");
	lines.push("");
	for (const r of resources) {
		const summary = r.summary ? ` — ${firstSentence(r.summary)}` : "";
		lines.push(`- ${mdLink(r.title, `${site.origin}/${r.slug}.md`)}${summary}`);
	}
	lines.push("");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /llms-full.txt — every page's full Markdown inlined.
// ---------------------------------------------------------------------------
export function renderLlmsFullTxt(ctx: RenderCtx): string {
	const { site, resources } = ctx;
	const lines: string[] = [];
	lines.push(`# ${site.name}`);
	lines.push("");
	lines.push(`> ${site.description}`);
	lines.push("");
	for (const r of resources) {
		lines.push(renderResourceMd({ resource: r, site }));
		lines.push("");
		lines.push("---");
		lines.push("");
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Homepage Markdown — returned only when an agent asks for text/markdown.
// ---------------------------------------------------------------------------
export function renderHomeMarkdown(ctx: RenderCtx): string {
	const { site, resources } = ctx;
	const lines = [
		`# ${site.name}`,
		"",
		`> ${site.description}`,
		"",
		"## Agent resources",
		"",
		`- ${mdLink("LLM content index", `${site.origin}/llms.txt`)}`,
		`- ${mdLink("Full content", `${site.origin}/llms-full.txt`)}`,
		`- ${mdLink("Structured content index", `${site.origin}/index.json`)}`,
		`- ${mdLink("Sitemap", `${site.origin}/sitemap.xml`)}`,
		"",
		"## Indexed pages",
		"",
		...resources.map((resource) => {
			const summary = resource.summary ? ` — ${firstSentence(resource.summary)}` : "";
			return `- ${mdLink(resource.title, `${site.origin}/${resource.slug}.md`)}${summary}`;
		}),
		"",
	];
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /index.json — typed JSON index, the structured-agent surface.
// ---------------------------------------------------------------------------
export function renderIndexJson(ctx: RenderCtx) {
	const { site, resources } = ctx;
	return {
		protocol: INDEX_PROTOCOL,
		site: { name: site.name, description: site.description },
		// Derived from the latest content update (not wall-clock) so identical
		// content yields identical output — ETag/cache friendly.
		generatedAt: latestUpdatedAt(resources),
		surfaces: {
			homeMarkdown: `${site.origin}/`,
			llmsTxt: `${site.origin}/llms.txt`,
			llmsFullTxt: `${site.origin}/llms-full.txt`,
			json: `${site.origin}/index.json`,
			pageMarkdown: `${site.origin}/{slug}.md`,
			robots: `${site.origin}/robots.txt`,
			sitemap: `${site.origin}/sitemap.xml`,
			apiCatalog: `${site.origin}/.well-known/api-catalog`,
			agentSkills: `${site.origin}/.well-known/agent-skills/index.json`,
			ardCatalog: `${site.origin}/.well-known/ai-catalog.json`,
		},
		pages: resources.map((r) => ({
			slug: r.slug,
			url: r.url,
			title: r.title,
			summary: r.summary,
			keyPoints: r.keyPoints,
			topics: r.topics,
			category: r.category,
			updatedAt: r.updatedAt,
			sources: {
				markdown: `${site.origin}/${r.slug}.md`,
				canonical: r.url,
			},
		})),
	};
}

// ---------------------------------------------------------------------------
// /sitemap.xml — canonical map of the content surfaces hosted by this Worker.
// ---------------------------------------------------------------------------
export function renderSitemapXml(ctx: RenderCtx): string {
	const { site, resources } = ctx;
	const pages = [
		{ loc: `${site.origin}/`, lastmod: latestUpdatedAt(resources) },
		...resources.map((resource) => ({
			loc: `${site.origin}/${resource.slug}.md`,
			lastmod: resource.updatedAt,
		})),
	];
	const entries = pages
		.map(
			(page) =>
				`  <url><loc>${escapeXml(page.loc)}</loc><lastmod>${escapeXml(page.lastmod)}</lastmod></url>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

// ---------------------------------------------------------------------------
// /<slug>.md — per-page Markdown, ideal for grounding/citation.
// ---------------------------------------------------------------------------
export function renderResourceMd(args: {
	resource: Resource;
	site: SiteConfig;
}): string {
	const r = args.resource;
	const lines: string[] = [];
	lines.push(`# ${r.title}`);
	lines.push("");
	if (r.category) lines.push(`*Category: ${r.category}*`);
	if (r.topics.length) lines.push(`*Topics: ${r.topics.join(", ")}*`);
	if (r.category || r.topics.length) lines.push("");
	if (r.summary) {
		lines.push(r.summary);
		lines.push("");
	}
	if (r.keyPoints.length) {
		lines.push("## Key points");
		lines.push("");
		for (const k of r.keyPoints) lines.push(`- ${k}`);
		lines.push("");
	}
	if (r.content) {
		lines.push("## Content");
		lines.push("");
		lines.push(r.content);
		lines.push("");
	}
	lines.push("## Source");
	lines.push("");
	lines.push(`- Canonical URL: ${r.url}`);
	lines.push(`- Typed record: ${args.site.origin}/index.json`);
	lines.push("");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// /robots.txt — explicitly welcome AI agents and point them at llms.txt.
// ---------------------------------------------------------------------------
export function renderRobotsTxt(ctx: RenderCtx): string {
	const { site } = ctx;
	// Content Signals are expressed as a `Content-Signal:` directive inside a
	// robots.txt User-agent group (see https://contentsignals.org). We emit it
	// per group so the canonical place a crawler looks carries the policy.
	const signal = ctx.contentSignal;
	const lines: string[] = [];
	lines.push("# Robots directives for AI agents and crawlers.");
	lines.push("# This site intentionally welcomes AI agents — see /llms.txt.");
	lines.push("");
	for (const agent of KNOWN_AI_AGENTS) {
		lines.push(`User-agent: ${agent}`);
		lines.push("Allow: /");
		if (signal) lines.push(`Content-Signal: ${signal}`);
		lines.push("");
	}
	lines.push("User-agent: *");
	lines.push("Allow: /");
	if (signal) lines.push(`Content-Signal: ${signal}`);
	lines.push("");
	lines.push("# Machine-readable indexes for agents:");
	lines.push(`# - ${site.origin}/llms.txt`);
	lines.push(`# - ${site.origin}/index.json`);
	lines.push("");
	lines.push(`Sitemap: ${site.origin}/sitemap.xml`);
	lines.push("");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// API and capability discovery surfaces.
// ---------------------------------------------------------------------------
export function renderOpenApiDocument(ctx: RenderCtx): object {
	const { site } = ctx;
	return {
		openapi: "3.1.0",
		info: {
			title: `${site.name} content API`,
			version: "1.0.0",
			description:
				"Read-only endpoints for discovering the site's AI-enriched content.",
		},
		servers: [{ url: site.origin }],
		paths: {
			"/api/site": {
				get: { summary: "Get site metadata and discovery surfaces", responses: { "200": { description: "Site metadata" } } },
			},
			"/api/resources": {
				get: { summary: "List enriched content resources", responses: { "200": { description: "Content resources" } } },
			},
			"/api/resources/{slug}": {
				get: {
					summary: "Get one enriched content resource",
					parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
					responses: { "200": { description: "Content resource" }, "404": { description: "Not found" } },
				},
			},
		},
	};
}

export function renderApiCatalog(ctx: RenderCtx): object {
	const { site } = ctx;
	return {
		linkset: [
			{
				anchor: `${site.origin}/api`,
				"service-desc": [
					{
						href: `${site.origin}/.well-known/openapi.json`,
						type: "application/vnd.oai.openapi+json;version=3.1",
						title: `${site.name} content API description`,
					},
				],
				"service-doc": [
					{
						href: `${site.origin}/llms.txt`,
						type: "text/plain",
						title: "Agent-readable content directory",
					},
				],
				"service-meta": [{ href: `${site.origin}/index.json`, type: "application/json" }],
				status: [{ href: `${site.origin}/api/site`, type: "application/json" }],
			},
		],
	};
}

export async function renderAgentSkillsIndex(ctx: RenderCtx): Promise<object> {
	const digest = await sha256Digest(AGENT_VISIBILITY_SKILL);
	return {
		$schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		skills: [
			{
				name: "agent-visibility",
				type: "skill-md",
				description: `Discover and consume AI-readable content and public content APIs from ${ctx.site.name}.`,
				url: AGENT_SKILL_PATH,
				digest,
			},
		],
	};
}

export function renderArdCatalog(ctx: RenderCtx): object {
	const { site } = ctx;
	const hostname = new URL(site.origin).hostname;
	return {
		specVersion: "1.0",
		host: { name: hostname, url: site.origin },
		entries: [
			{
				id: `urn:air:${hostname}:content:llms-index`,
				displayName: "LLM content index",
				type: "text/markdown",
				url: `${site.origin}/llms.txt`,
				representativeQueries: [
					"What content does this site publish?",
					"Where can I find the site's AI-readable documentation?",
				],
			},
			{
				id: `urn:air:${hostname}:api:content-api`,
				displayName: "Public content API",
				type: "application/vnd.oai.openapi+json",
				url: `${site.origin}/.well-known/openapi.json`,
				representativeQueries: [
					"List the site's indexed resources.",
					"Retrieve structured content metadata.",
				],
			},
		],
	};
}

// ---------------------------------------------------------------------------
// JSON-LD (schema.org) — what classic + AI crawlers parse from HTML pages.
// ---------------------------------------------------------------------------
export function renderWebsiteJsonLd(ctx: RenderCtx): object {
	const { site, resources } = ctx;
	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: site.name,
		description: site.description,
		url: site.origin,
		mainEntity: {
			"@type": "ItemList",
			itemListElement: resources.map((r, i) => ({
				"@type": "ListItem",
				position: i + 1,
				url: `${site.origin}/${r.slug}.md`,
				name: r.title,
			})),
		},
	};
}

export function renderResourceJsonLd(args: {
	resource: Resource;
	site: SiteConfig;
}): object {
	const r = args.resource;
	return {
		"@context": "https://schema.org",
		"@type": "Article",
		headline: r.title,
		abstract: r.summary,
		keywords: r.topics.join(", "),
		articleSection: r.category ?? undefined,
		url: r.url,
		dateModified: r.updatedAt,
		isPartOf: {
			"@type": "WebSite",
			name: args.site.name,
			url: args.site.origin,
		},
	};
}

function firstSentence(text: string): string {
	return text.split(/(?<=[.!?])\s+/)[0]?.trim() ?? text;
}

/** Most recent `updatedAt` across resources (epoch start if empty). */
function latestUpdatedAt(resources: Resource[]): string {
	let latest = 0;
	for (const r of resources) {
		const t = Date.parse(r.updatedAt);
		if (Number.isFinite(t) && t > latest) latest = t;
	}
	return new Date(latest).toISOString();
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'\"]/g, (character) => {
		return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[character] ?? character;
	});
}

async function sha256Digest(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const hash = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

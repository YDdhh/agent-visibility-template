/**
 * Public, read-only MCP server for the Agent Visibility site.
 *
 * It deliberately exposes only discovery operations. No credentials, user
 * data, or mutating endpoints are available through this transport.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
	MCP_SERVER_NAME,
	MCP_SERVER_VERSION,
} from "../lib/mcp";
import { getResources, siteConfig } from "../lib/store";
import type { Env } from "../lib/types";

export function createAgentVisibilityMcpServer(env: Env, origin: string) {
	const server = new McpServer({
		name: MCP_SERVER_NAME,
		version: MCP_SERVER_VERSION,
	});

	server.registerTool(
		"hello",
		{
			description: "Return a greeting from the Agent Visibility MCP server.",
			inputSchema: { name: z.string().trim().min(1).max(100).optional() },
		},
		async ({ name }) => ({
			content: [
				{
					type: "text",
					text: `Hello, ${name ?? "World"}! This is the Agent Visibility MCP server.`,
				},
			],
		}),
	);

	server.registerTool(
		"list_resources",
		{
			description:
				"List the site's public, AI-readable content resources. This operation is read-only.",
			inputSchema: {
				limit: z.number().int().min(1).max(20).optional(),
			},
		},
		async ({ limit }) => {
			const site = siteConfig(env, origin);
			const resources = await getResources(env);
			const result = {
				site: { name: site.name, description: site.description, origin: site.origin },
				count: resources.length,
				resources: resources.slice(0, limit ?? 20).map((resource) => ({
					slug: resource.slug,
					title: resource.title,
					summary: resource.summary,
					topics: resource.topics,
					markdown: `${origin}/${resource.slug}.md`,
				})),
			};
			return {
				structuredContent: result,
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	server.registerTool(
		"get_resource",
		{
			description:
				"Get one public content resource by slug. This operation is read-only.",
			inputSchema: {
				slug: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,62})$/),
			},
		},
		async ({ slug }) => {
			const resource = (await getResources(env)).find(
				(candidate) => candidate.slug === slug,
			);
			if (!resource) {
				return {
					isError: true,
					content: [{ type: "text", text: `No resource exists with slug \"${slug}\".` }],
				};
			}
			const result = {
				...resource,
				markdown: `${origin}/${resource.slug}.md`,
			};
			return {
				structuredContent: result,
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		},
	);

	return server;
}

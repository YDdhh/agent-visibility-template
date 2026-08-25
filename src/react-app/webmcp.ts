/**
 * Browser-local, read-only WebMCP tools.
 *
 * WebMCP is still evolving. We use the current imperative Document API and
 * retain a guarded compatibility path for earlier preview implementations.
 */
type WebMcpTool = {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: { readOnlyHint: boolean };
	execute: (input: Record<string, unknown>) => Promise<string>;
};

type ModernModelContext = {
	registerTool: (tool: WebMcpTool) => Promise<void>;
};

type LegacyModelContext = {
	provideContext: (context: { tools: WebMcpTool[] }) => void | Promise<void>;
};

let registered = false;

async function getJson(path: string): Promise<unknown> {
	const response = await fetch(path, { headers: { Accept: "application/json" } });
	if (!response.ok) throw new Error(`${path} returned ${response.status}.`);
	return response.json();
}

const tools: WebMcpTool[] = [
	{
		name: "list_agent_resources",
		title: "List agent-readable resources",
		description:
			"List this site's public AI-readable resources. This tool only reads published content.",
		inputSchema: { type: "object", additionalProperties: false },
		annotations: { readOnlyHint: true },
		execute: async () => JSON.stringify(await getJson("/api/resources"), null, 2),
	},
	{
		name: "get_agent_site_info",
		title: "Get agent discovery information",
		description:
			"Get the site's public agent-discovery endpoints and metadata. This tool only reads published content.",
		inputSchema: { type: "object", additionalProperties: false },
		annotations: { readOnlyHint: true },
		execute: async () => JSON.stringify(await getJson("/api/site"), null, 2),
	},
];

export function registerWebMcpTools(): void {
	if (registered) return;

	const modern = (document as Document & { modelContext?: ModernModelContext })
		.modelContext;
	if (modern?.registerTool) {
		registered = true;
		void Promise.all(tools.map((tool) => modern.registerTool(tool))).catch(() => {
			registered = false;
		});
		return;
	}

	const legacy = (navigator as Navigator & { modelContext?: LegacyModelContext })
		.modelContext;
	if (legacy?.provideContext) {
		registered = true;
		void Promise.resolve(legacy.provideContext({ tools })).catch(() => {
			registered = false;
		});
	}
}

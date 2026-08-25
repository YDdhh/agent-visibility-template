/**
 * The enriched-resource store, backed by Workers KV.
 *
 * On a cold public read we create a deterministic, immediately available
 * projection of the sample content (or whatever has been POSTed to
 * /api/resources) and cache it. Explicit content updates use Workers AI for
 * enrichment; subsequent reads are served straight from KV until expiry or a
 * cache clear.
 */
import { enrichAll, enrichResource, fallbackEnrichment } from "../enrichment";
import { SAMPLE_RESOURCES } from "./content";
import type { Env, RawResource, Resource, SiteConfig } from "./types";

/** KV key holding the enriched `Resource[]`. Exported so tests can seed it. */
export const ENRICHED_KEY = "resources:enriched";
/** KV key holding the configured raw resources. */
export const RAW_KEY = "resources:raw";

export function siteConfig(env: Env, origin: string): SiteConfig {
	return {
		name: env.SITE_NAME || "My Site",
		description: env.SITE_DESCRIPTION || "Content made visible to AI agents.",
		origin,
	};
}

function ttlSeconds(env: Env): number {
	const n = Number(env.ENRICHMENT_CACHE_TTL);
	return Number.isFinite(n) && n > 0 ? n : 3600;
}

/** Short TTL used when results are degraded so a transient outage can't poison surfaces for the full TTL. */
const DEGRADED_TTL = 60;

/** True when any resource fell back to deterministic enrichment. */
function isDegraded(resources: Resource[]): boolean {
	return resources.some((r) => r.model.endsWith("(fallback)"));
}

function cacheTtl(env: Env, resources: Resource[]): number {
	return isDegraded(resources) ? DEGRADED_TTL : ttlSeconds(env);
}

/** Raw resources the site owner has configured (defaults to the samples). */
async function getRawResources(env: Env): Promise<RawResource[]> {
	const stored = await env.VISIBILITY_CACHE.get(RAW_KEY, "json");
	if (Array.isArray(stored) && stored.length) {
		return stored as RawResource[];
	}
	return SAMPLE_RESOURCES;
}

/**
 * Get the resource store without making public discovery endpoints depend on
 * a model invocation. A cold GET returns a deterministic, immediately useful
 * projection and caches it; AI enrichment remains available when an editor
 * explicitly POSTs or updates a resource. This keeps robots.txt, sitemaps and
 * the homepage within crawler timeouts even when Workers AI is unavailable or
 * under load.
 */
export async function getResources(env: Env): Promise<Resource[]> {
	const cached = await env.VISIBILITY_CACHE.get(ENRICHED_KEY, "json");
	if (Array.isArray(cached) && cached.length) {
		return cached as Resource[];
	}

	const raws = await getRawResources(env);
	const immediate = raws.map((raw) => fallbackEnrichment(raw, env.AI_MODEL));
	await env.VISIBILITY_CACHE.put(ENRICHED_KEY, JSON.stringify(immediate), {
		expirationTtl: ttlSeconds(env),
	});
	return immediate;
}

/**
 * Add (or replace) a single raw resource, enrich just that resource, and
 * update the store. Enforces `maxResources` to bound KV growth.
 *
 * Throws `Error("RESOURCE_LIMIT")` if adding a *new* slug would exceed the cap.
 */
export async function upsertResource(
	env: Env,
	raw: RawResource,
	maxResources = 100,
): Promise<Resource> {
	const raws = await getRawResources(env);
	const isNew = !raws.some((r) => r.slug === raw.slug);
	if (isNew && raws.length >= maxResources) {
		throw new Error("RESOURCE_LIMIT");
	}

	const nextRaws = [...raws.filter((r) => r.slug !== raw.slug), raw];
	await env.VISIBILITY_CACHE.put(RAW_KEY, JSON.stringify(nextRaws));

	// Enrich only the new/changed resource.
	const enriched = await enrichResource(env.AI, env.AI_MODEL, raw);

	// Reuse the warm enriched cache if present; only fall back to enriching the
	// other resources when the cache is cold (avoids re-enriching everything,
	// and avoids enriching `raw` twice).
	const cached = await env.VISIBILITY_CACHE.get(ENRICHED_KEY, "json");
	let others: Resource[];
	if (Array.isArray(cached) && cached.length) {
		others = (cached as Resource[]).filter((r) => r.slug !== raw.slug);
	} else {
		const otherRaws = nextRaws.filter((r) => r.slug !== raw.slug);
		others = await enrichAll(env.AI, env.AI_MODEL, otherRaws);
	}

	const next = [...others, enriched];
	await env.VISIBILITY_CACHE.put(ENRICHED_KEY, JSON.stringify(next), {
		expirationTtl: cacheTtl(env, next),
	});
	return enriched;
}

/** Clear the enriched cache so the next read re-enriches from raw. */
export async function clearCache(env: Env): Promise<void> {
	await env.VISIBILITY_CACHE.delete(ENRICHED_KEY);
}

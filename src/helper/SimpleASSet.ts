import { parse } from "yaml";

import ASSet from "../core/construct/as_set";
import { execFile } from "node:child_process";

const DEFAULT_BGPQ4_HOST = "whois.radb.net";

// In-process cache for bgpq4 expansion results.
// Keyed by `${name}|${depth}|${sources}` and caches the Promise to dedupe concurrent calls.
const FLATTEN_CACHE = new Map<string, Promise<string[]>>();

type YamlMemberConfig = {
	flat?: boolean;
	depth?: number;
	source?: string;
};

type YamlMember = string | Record<string, YamlMemberConfig | null | undefined>;

export type MemberSpec = {
	name: string;
	flat?: boolean;
	depth?: number;
	/**
	 * bgpq4 -S sources override for this member.
	 * YAML uses `source`, but bgpq4 expects a sources list string.
	 */
	sources?: string;
};

export type FlattenOptions = {
	timeoutMs?: number;
	/**
	 * If bgpq4 returns empty for a flat member.
	 * - keep: keep the original AS-SET name in members (default)
	 * - empty: drop it
	 * - error: throw
	 */
	onEmpty?: "keep" | "empty" | "error";
};

interface SimpleASSetYaml {
	name?: unknown;
	source?: unknown;
	description?: unknown;
	remarks?: unknown;
	created?: unknown;
	orgHandle?: unknown;
	pocLinks?: unknown;
	members?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);

const splitMultiline = (value: unknown): string[] => {
	if (typeof value !== "string") return [];
	return value
		.split(/\r?\n/)
		.map((s) => s.trimEnd())
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
};

const parseDate = (value: unknown): Date | null => {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	if (typeof value === "string") {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? null : d;
	}
	return null;
};

export const parseMemberSpecs = (value: unknown): MemberSpec[] => {
	if (!Array.isArray(value)) return [];
	const out: MemberSpec[] = [];
	for (const item of value as YamlMember[]) {
		if (typeof item === "string") {
			const name = item.trim();
			if (name) out.push({ name });
			continue;
		}
		if (isRecord(item)) {
			const record = item as Record<string, unknown>;
			const reservedKeys = new Set(["flat", "depth", "source"]);

			const commonFlat =
				typeof record.flat === "boolean" ? record.flat : undefined;
			const commonDepth =
				typeof record.depth === "number" ? record.depth : undefined;
			const commonSources =
				typeof record.source === "string" ? record.source.trim() : undefined;

			for (const [rawName, cfg] of Object.entries(record)) {
				if (reservedKeys.has(rawName)) continue;
				const name = rawName.trim();
				if (!name) continue;

				let flat = commonFlat;
				let depth = commonDepth;
				let sources = commonSources;

				if (cfg && typeof cfg === "object" && !Array.isArray(cfg)) {
					const nested = cfg as YamlMemberConfig;
					flat = typeof nested.flat === "boolean" ? nested.flat : flat;
					depth = typeof nested.depth === "number" ? nested.depth : depth;
					sources =
						typeof nested.source === "string" ? nested.source.trim() : sources;
				}

				out.push({ name, flat, depth, sources });
			}
			continue;
		}
	}
	return out;
};

const normalizeMembers = (value: unknown): string[] =>
	parseMemberSpecs(value).map((s) => s.name);

const sanitizeListName = (name: string): string => {
	const sanitized = name.replace(/[^A-Za-z0-9_]/g, "_");
	return sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
};

const execFileAsync = (
	file: string,
	args: string[],
	options: { timeout?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				timeout: options.timeout,
				maxBuffer: options.maxBuffer,
			},
			(err, stdout, stderr) => {
				if (err) {
					reject(
						new Error(
							`bgpq4 failed (exit ${
								(err as any)?.code ?? "unknown"
							}): ${stderr || (err as Error).message}`
						)
					);
					return;
				}
				resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
			}
		);
	});

const cacheKey = (spec: MemberSpec, sourcesArg?: string): string => {
	const depthPart = typeof spec.depth === "number" ? String(spec.depth) : "";
	const sourcesPart = sourcesArg?.trim() ?? "";
	return `${spec.name}|${depthPart}|${sourcesPart}`;
};

const queryBgpq4ExpandedASNs = async (
	spec: MemberSpec,
	timeoutMs: number,
	sourcesArg?: string
): Promise<string[]> => {
	const listName = sanitizeListName(spec.name);
	const args: string[] = ["-j", "-t", "-h", DEFAULT_BGPQ4_HOST, "-l", listName];
	if (sourcesArg && sourcesArg.trim().length > 0) {
		args.push("-S", sourcesArg.trim());
	}
	if (typeof spec.depth === "number" && spec.depth >= 0) {
		args.push("-L", String(spec.depth));
	}
	args.push(spec.name);

	const { stdout } = await execFileAsync("bgpq4", args, {
		timeout: timeoutMs,
		maxBuffer: 10 * 1024 * 1024,
	});

	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`bgpq4 returned non-JSON output: ${stdout.slice(0, 200)}`);
	}
	if (!isRecord(parsed)) {
		throw new Error("bgpq4 JSON output is not an object");
	}

	const obj = parsed as Record<string, unknown>;
	const bucket =
		Array.isArray(obj[listName])
			? (obj[listName] as unknown[])
			: Array.isArray(obj[Object.keys(obj)[0] ?? ""])
				? (obj[Object.keys(obj)[0] ?? ""] as unknown[])
				: [];

	return bucket
		.map((v) => (typeof v === "number" ? String(v) : ""))
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map((s) => `AS${s}`);
};

const queryBgpq4ExpandedASNsCached = (
	spec: MemberSpec,
	timeoutMs: number,
	sourcesArg?: string
): Promise<string[]> => {
	const key = cacheKey(spec, sourcesArg);
	const cached = FLATTEN_CACHE.get(key);
	if (cached) return cached;

	const promise = queryBgpq4ExpandedASNs(spec, timeoutMs, sourcesArg).catch(
		(err) => {
			// Don't cache failures.
			FLATTEN_CACHE.delete(key);
			throw err;
		}
	);
	FLATTEN_CACHE.set(key, promise);
	return promise;
};

export const flattenMemberWithBgpq4 = async (
	spec: MemberSpec,
	options: FlattenOptions = {},
	sources?: string
): Promise<string[]> => {
	if (!spec.flat) return [spec.name];

	const timeoutMs = options.timeoutMs ?? 20_000;

	const asnsWithSources = await queryBgpq4ExpandedASNsCached(
		spec,
		timeoutMs,
		sources
	);
	if (asnsWithSources.length > 0) return asnsWithSources;

	const asnsFallback = sources
		? await queryBgpq4ExpandedASNsCached(spec, timeoutMs, undefined)
		: [];
	if (asnsFallback.length > 0) return asnsFallback;

	switch (options.onEmpty ?? "keep") {
		case "empty":
			return [];
		case "error":
			throw new Error(`bgpq4 returned empty expansion for ${spec.name}`);
		case "keep":
		default:
			return [spec.name];
	}
};

export const resolveMembers = async (
	specs: MemberSpec[],
	options: FlattenOptions = {},
	sources?: string
): Promise<string[]> => {
	const out: string[] = [];
	for (const spec of specs) {
		const resolved = await flattenMemberWithBgpq4(
			spec,
			options,
			spec.sources ?? sources
		);
		out.push(...resolved);
	}
	return Array.from(new Set(out));
};

const normalizePocLinks = (value: unknown): ARINPocLink[] => {
	if (!Array.isArray(value)) return [];
	const out: ARINPocLink[] = [];
	for (const item of value as unknown[]) {
		if (!isRecord(item)) continue;
		const handle = typeof item.handle === "string" ? item.handle.trim() : "";
		if (!handle) continue;
		const description =
			typeof item.description === "string" ? item.description : "";
		const functionValue = typeof item.function === "string" ? item.function : "";
		out.push({
			handle: { handle },
			description,
			function: functionValue,
		});
	}
	return out;
};

/**
 * Parse a YAML string (as generated by this repo) into the core ARIN `ASSet` type.
 *
 * Notes:
 * - `description`/`remarks` are split into line arrays (empty lines dropped).
 * - `members` entries with config (object form) are downgraded to their key names.
 */
export const ASSetFromYaml = (yamlText: string): ASSet => {
	const obj = parse(yamlText) as unknown;
	return ASSetFromYamlObject(obj);
};

export const ASSetFromYamlObject = (value: unknown): ASSet => {
	if (!isRecord(value)) {
		throw new Error("Invalid ASSet YAML: root must be a mapping/object");
	}

	const y = value as SimpleASSetYaml;

	const name = typeof y.name === "string" ? y.name.trim() : "";
	if (!name) {
		throw new Error("Invalid ASSet YAML: missing/empty 'name'");
	}

	const source = typeof y.source === "string" ? y.source.trim() : "";
	if (source && source !== "ARIN") {
		throw new Error(`Invalid ASSet YAML: unsupported 'source' (${source})`);
	}

	const asSet = new ASSet({
		name,
		creationDate: parseDate(y.created),
		descriptions: splitMultiline(y.description),
		remarks: splitMultiline(y.remarks),
		members: normalizeMembers(y.members),
		pocLinks: normalizePocLinks(y.pocLinks),
		orgHandle:
			typeof y.orgHandle === "string" && y.orgHandle.trim().length > 0
				? { handle: y.orgHandle.trim() }
				: null,
	});

	return asSet;
};

/**
 * Parse YAML into `ASSet`, and expand any member with `{ flat: true }` via bgpq4.
 */
export const ASSetFromYamlAndFlatten = async (
	yamlText: string,
	options: FlattenOptions = {}
): Promise<ASSet> => {
	const obj = parse(yamlText) as unknown;
	if (!isRecord(obj)) {
		throw new Error("Invalid ASSet YAML: root must be a mapping/object");
	}
	const y = obj as SimpleASSetYaml;
	const asSet = ASSetFromYamlObject(obj);
	const source = typeof y.source === "string" ? y.source.trim() : "";
	if (!source) {
		throw new Error("Invalid ASSet YAML: missing/empty 'source' for flattening");
	}
	const specs = parseMemberSpecs(y.members);
	asSet.members = await resolveMembers(specs, options, source);
	return asSet;
};

export default ASSetFromYamlAndFlatten;


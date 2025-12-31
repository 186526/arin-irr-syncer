import { XMLBuilder, XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	textNodeName: "#text",
	removeNSPrefix: true,
});

const builder = new XMLBuilder({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	textNodeName: "#text",
	format: true,
	indentBy: "    ",
});

export default class ASSet {
	public name: string = "";
	public creationDate: Date | null = null;
	public lastModifiedDate: Date | null = null;
	public descriptions: string[] = [];
	public remarks?: string[] = [];
	public pocLinks: ARINPocLink[] = [];
	public orgHandle: ARINOrg | null = null;
	public readonly source = "ARIN";
	public members: string[] = [];

	private static normalizeArray = <T>(
		value: T | T[] | undefined | null
	): T[] => {
		if (value === undefined || value === null) return [];
		return Array.isArray(value) ? value : [value];
	};

	private static toText = (value: unknown): string => {
		if (typeof value === "string") return value;
		if (value && typeof value === "object" && "#text" in (value as any)) {
			const text = (value as any)["#text"];
			return typeof text === "string" ? text : "";
		}
		return "";
	};

	private static parseDate = (value: unknown): Date | null => {
		if (typeof value !== "string") return null;
		const date = new Date(value);
		return Number.isNaN(date.getTime()) ? null : date;
	};

	private static normalizeMembers = (members: string[]): string[] =>
		members
			.map((s) => (typeof s === "string" ? s.trim() : ""))
			.filter((s) => s.length > 0)
			.sort((a, b) => a.localeCompare(b));

	private reset(): void {
		this.name = "";
		this.creationDate = null;
		this.lastModifiedDate = null;
		this.descriptions = [];
		this.remarks = [];
		this.pocLinks = [];
		this.members = [];
		this.orgHandle = null;
	}

	private static parseRpslFields(rpslText: string): Record<string, string[]> {
		type FieldMap = Record<string, string[]>;
		const fields: FieldMap = Object.create(null);
		let lastKey: string | null = null;

		const pushField = (keyRaw: string, valueRaw: string) => {
			const key = keyRaw.trim().toLowerCase();
			const value = valueRaw.trim();
			if (!key) return;
			if (!fields[key]) fields[key] = [];
			fields[key].push(value);
			lastKey = key;
		};

		const appendContinuation = (valueRaw: string) => {
			if (!lastKey) return;
			const value = valueRaw.replace(/^[ \t]+/, "");
			const arr = fields[lastKey];
			if (!arr || arr.length === 0) return;
			arr[arr.length - 1] = `${arr[arr.length - 1]}\n${value}`.trimEnd();
		};

		const rawLines = rpslText.replace(/\r\n/g, "\n").split("\n");
		for (const rawLine of rawLines) {
			const line = rawLine.trimEnd();
			if (!line) {
				lastKey = null;
				continue;
			}
			if (line.startsWith("#") || line.startsWith("%")) continue;
			if (/^[ \t]/.test(rawLine)) {
				appendContinuation(rawLine);
				continue;
			}

			const idx = line.indexOf(":");
			if (idx < 0) continue;
			const key = line.slice(0, idx);
			const value = line.slice(idx + 1);
			pushField(key, value);
		}

		return fields;
	}

	constructor(data?: Partial<ASSet>) {
		if (data) {
			Object.assign(this, data);
		}
	}

	fromXML(xmlString: string): void {
		const obj = parser.parse(xmlString) as any;
		const asSet = obj?.asSet;
		if (!asSet || typeof asSet !== "object") {
			throw new Error("Invalid ARIN asSet XML: missing <asSet> root");
		}

		this.reset();
		this.name = typeof asSet.name === "string" ? asSet.name.trim() : "";
		this.creationDate = ASSet.parseDate(asSet.creationDate);
		this.lastModifiedDate = ASSet.parseDate(asSet.lastModifiedDate);

		if (typeof asSet.source === "string" && asSet.source !== this.source) {
			throw new Error(`Unexpected <source>: ${asSet.source}`);
		}

		if (typeof asSet.orgHandle === "string" && asSet.orgHandle.trim()) {
			this.orgHandle = { handle: asSet.orgHandle.trim() };
		}

		// description/line can be string | object | array
		const lines = ASSet.normalizeArray(asSet?.description?.line);
		this.descriptions = lines
			.map((line) => ASSet.toText(line).trim())
			.filter((s) => s.length > 0);

		// remarks/line can be string | object | array
		const remarks = ASSet.normalizeArray(asSet?.remarks?.line);
		this.remarks = remarks
			.map((remark) => ASSet.toText(remark).trim())
			.filter((s) => s.length > 0);

		// pocLinks/pocLinkRef can be object | array
		const pocLinkRefs = ASSet.normalizeArray(asSet?.pocLinks?.pocLinkRef);
		this.pocLinks = pocLinkRefs
			.map((ref: any): ARINPocLink | null => {
				const description =
					typeof ref?.description === "string" ? ref.description : "";
				const functionValue =
					typeof ref?.function === "string" ? ref.function : "";
				const handleValue = typeof ref?.handle === "string" ? ref.handle : "";
				if (!handleValue) return null;
				return {
					description,
					function: functionValue,
					handle: { handle: handleValue },
				};
			})
			.filter((v): v is ARINPocLink => v !== null);

		// members/member can be object | array
		const memberNodes = ASSet.normalizeArray(asSet?.members?.member);
		this.members = ASSet.normalizeMembers(
			memberNodes
				.map((m: any) => (typeof m?.name === "string" ? m.name : ""))
				.map((s) => s.trim())
				.filter((s) => s.length > 0)
		);
	}

	toXML(): string {
		if (!this.name || !this.name.trim()) {
			throw new Error("ASSet.name is required");
		}
		if (!this.orgHandle?.handle || !this.orgHandle.handle.trim()) {
			throw new Error("ASSet.orgHandle is required");
		}

		const asSet: any = {
			"@_xmlns": "http://www.arin.net/regrws/core/v1",
		};

		if (this.creationDate) {
			asSet.creationDate = this.creationDate.toISOString();
		}

		if (this.descriptions.length > 0) {
			asSet.description = {
				line: this.descriptions
					.map((text, index) => ({
						"@_number": String(index),
						"#text": text,
					}))
					.filter(
						(line) =>
							typeof line["#text"] === "string" &&
							line["#text"].trim().length > 0
					),
			};
		}

		if (this.remarks && this.remarks.length > 0) {
			asSet.remarks = {
				line: this.remarks
					.map((text, index) => ({
						"@_number": String(index),
						"#text": text,
					}))
					.filter(
						(remark) =>
							typeof remark["#text"] === "string" &&
							remark["#text"].trim().length > 0
					),
			};
		}

		if (this.lastModifiedDate) {
			asSet.lastModifiedDate = this.lastModifiedDate.toISOString();
		}

		asSet.orgHandle = this.orgHandle.handle.trim();

		if (this.pocLinks.length > 0) {
			const pocLinkRef = this.pocLinks
				.map((p) => ({
					"@_description": p.description ?? "",
					"@_function": p.function ?? "",
					"@_handle": p.handle?.handle ?? "",
				}))
				.filter(
					(p) =>
						typeof p["@_handle"] === "string" && p["@_handle"].trim().length > 0
				);
			if (pocLinkRef.length > 0) {
				asSet.pocLinks = { pocLinkRef };
			}
		}

		asSet.source = this.source;

		const sortedMembers = ASSet.normalizeMembers(this.members);
		if (sortedMembers.length > 0) {
			const member = sortedMembers
				.map((name) => ({ "@_name": name }))
				.filter(
					(m) =>
						typeof m["@_name"] === "string" && m["@_name"].trim().length > 0
				);
			if (member.length > 0) {
				asSet.members = { member };
			}
		}

		asSet.name = this.name.trim();

		const xml = builder.build({ asSet });
		return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
	}

	toRPSL(): string {
		if (!this.name || !this.name.trim()) {
			throw new Error("ASSet.name is required");
		}

		const lines: string[] = [];
		lines.push(`as-set: ${this.name.trim()}`);

		for (const d of this.descriptions) {
			const text = typeof d === "string" ? d.trim() : "";
			if (text) lines.push(`descr: ${text}`);
		}

		if (this.remarks) {
			for (const r of this.remarks) {
				const text = typeof r === "string" ? r.trim() : "";
				if (text) lines.push(`remarks: ${text}`);
			}
		}

		if (this.orgHandle?.handle && this.orgHandle.handle.trim()) {
			lines.push(`org-handle: ${this.orgHandle.handle.trim()}`);
		}

		// map pocLinks -> tech-c/admin-c
		for (const p of this.pocLinks) {
			const handle = p?.handle?.handle?.trim?.() ?? "";
			if (!handle) continue;
			if (p.function === "T") {
				lines.push(`tech-c: ${handle}`);
			} else if (p.function === "AD") {
				lines.push(`admin-c: ${handle}`);
			}
		}

		for (const m of ASSet.normalizeMembers(this.members)) {
			const text = typeof m === "string" ? m.trim() : "";
			if (text) lines.push(`members: ${text}`);
		}

		lines.push(`source: ${this.source}`);
		return `${lines.join("\n")}\n`;
	}

	fromRPSL(rpslText: string): void {
		if (typeof rpslText !== "string" || rpslText.trim().length === 0) {
			throw new Error("Invalid RPSL: empty input");
		}

		this.reset();
		const fields = ASSet.parseRpslFields(rpslText);

		const asSetNames = fields["as-set"] ?? fields["as_set"] ?? [];
		const name = (asSetNames[0] ?? "").trim();
		if (!name) {
			throw new Error("Invalid RPSL: missing 'as-set' attribute");
		}
		this.name = name;

		const sourceValues = fields["source"] ?? [];
		const source = (sourceValues[0] ?? "").trim();
		if (source && source !== this.source) {
			throw new Error(`Unexpected source: ${source}`);
		}

		const orgHandleValues =
			fields["org-handle"] ?? fields["org_handle"] ?? fields["orghandle"] ?? [];
		const orgHandle = (orgHandleValues[0] ?? "").trim();
		if (orgHandle) {
			this.orgHandle = { handle: orgHandle };
		}

		this.descriptions = (fields["descr"] ?? [])
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

		this.remarks = (fields["remarks"] ?? [])
			.flatMap((s) =>
				s
					.split(/\n/)
					.map((x) => x.trim())
					.filter((x) => x.length > 0)
			)
			.filter((s) => s.length > 0);

		this.members = ASSet.normalizeMembers(
			(fields["members"] ?? []).map((s) => s.trim()).filter((s) => s.length > 0)
		);

		const makePoc = (handle: string, fn: "T" | "AD", desc: string) => {
			const h = handle.trim();
			if (!h) return;
			this.pocLinks.push({
				handle: { handle: h },
				function: fn,
				description: desc,
			});
		};

		for (const h of fields["tech-c"] ?? []) {
			makePoc(h, "T", "Tech");
		}
		for (const h of fields["admin-c"] ?? []) {
			makePoc(h, "AD", "Admin");
		}
	}

	public toString = this.toRPSL;
}

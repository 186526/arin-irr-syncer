import axios from "axios";
import ASSet from "./construct/as_set";
import { XMLParser } from "fast-xml-parser";

enum ARIObjectType {
	route = "route",
	route6 = "route6",
	aut_num = "aut-num",
	as_set = "as-set",
	route_set = "route-set",
}

enum ARIObjectMethod {
	get = "GET",
	post = "POST",
	put = "PUT",
	delete = "DELETE",
}

enum ARIObejctAction {
	create = "create",
	view = "view",
	delete = "delete",
	modify = "modify",
	list = "list",
}

class ARINIRM {
	URL: URL;
	apiKey: string;
	private task: ARITask | null = null;

	constructor(apiKey: string, APIUrl: string = "https://reg.arin.net/rest/") {
		this.URL = new URL(APIUrl);
		this.apiKey = apiKey;
	}

	view(): this {
		this.task = {
			objectAction: ARIObejctAction.view,
		};
		return this;
	}

	create() {
		this.task = {
			objectAction: ARIObejctAction.create,
		};
		return this;
	}

	delete() {
		this.task = {
			objectAction: ARIObejctAction.delete,
		};
		return this;
	}

	modify() {
		this.task = {
			objectAction: ARIObejctAction.modify,
		};
		return this;
	}

	list() {
		this.task = {
			objectAction: ARIObejctAction.list,
		};
		return this;
	}

	async as_set({
		ASSetName,
		OrgHandle,
		ASSetContent,
	}: ARIASSetOptions): Promise<ASSet[]> {
		if (!this.task) {
			throw new Error("You should specify action before object type");
		}

		const answer: ASSet[] = [];

		this.task.objectType = ARIObjectType.as_set;

		switch (this.task.objectAction) {
			case ARIObejctAction.view: {
				if (!ASSetName || ASSetName.trim().length === 0) {
					throw new Error("ASSetName is required for viewing AS-Set");
				}

				this.task.objectMethod = ARIObjectMethod.get;
				this.task.object = {
					path: `irr/as-set/${encodeURIComponent(ASSetName)}`,
				};

				const result = await this.executeTask();
				if (!result.isSuccess) {
					throw new Error(`Failed to view ASSet: ${result.resultMessage}`);
				}
				const ASSetObj = new ASSet();
				ASSetObj.fromXML(result.resultMessage);
				answer.push(ASSetObj);
				break;
			}
			case ARIObejctAction.list: {
				if (!OrgHandle || OrgHandle.trim().length === 0) {
					throw new Error("OrgHandle is required for listing AS-Sets");
				}

				this.task.objectMethod = ARIObjectMethod.get;
				this.task.object = {
					path: `org/${encodeURIComponent(OrgHandle)}/as-sets`,
				};

				const result = await this.executeTask();
				if (!result.isSuccess) {
					throw new Error(`Failed to list ASSets: ${result.resultMessage}`);
				}
				const parser = new XMLParser({
					ignoreAttributes: false,
					attributeNamePrefix: "",
					removeNSPrefix: true,
					textNodeName: "#text",
				});

				const obj = parser.parse(result.resultMessage) as any;
				const collection = obj?.collection;
				if (!collection || typeof collection !== "object") {
					throw new Error(
						"Invalid ARIN list response: missing <collection> root"
					);
				}

				const refs = collection.asSetRef;
				const refArray = Array.isArray(refs) ? refs : refs ? [refs] : [];
				for (const ref of refArray) {
					const name = typeof ref?.name === "string" ? ref.name.trim() : "";
					if (!name) continue;
					answer.push(new ASSet({ name }));
				}
				break;
			}
			case ARIObejctAction.create: {
				if (!ASSetContent || ASSetContent.trim().length === 0) {
					throw new Error("ASSetContent is required for creating AS-Set");
				}
				if (!OrgHandle || OrgHandle.trim().length === 0) {
					throw new Error("OrgHandle is required for creating AS-Set");
				}

				this.task.objectMethod = ARIObjectMethod.post;
				this.task.object = {
					path: `irr/as-set`,
					searchParams: {
						orgHandle: OrgHandle,
					},
				};
				this.task.objectValue = ASSetContent;

				const result = await this.executeTask();
				if (!result.isSuccess) {
					throw new Error(`Failed to create ASSet: ${result.resultMessage}`);
				}
				const ASSetObj = new ASSet();
				ASSetObj.fromXML(result.resultMessage);
				answer.push(ASSetObj);
				break;
			}
			case ARIObejctAction.modify: {
				if (!ASSetContent || ASSetContent.trim().length === 0) {
					throw new Error("ASSetContent is required for modifying AS-Set");
				}
				if (!ASSetName || ASSetName.trim().length === 0) {
					throw new Error("ASSetName is required for modifying AS-Set");
				}

				this.task.objectMethod = ARIObjectMethod.put;
				this.task.object = {
					path: `irr/as-set/${encodeURIComponent(ASSetName)}`,
				};
				this.task.objectValue = ASSetContent;

				const result = await this.executeTask();
				if (!result.isSuccess) {
					throw new Error(`Failed to modify ASSet: ${result.resultMessage}`);
				}
				const ASSetObj = new ASSet();
				ASSetObj.fromXML(result.resultMessage);
				answer.push(ASSetObj);
				break;
			}
			case ARIObejctAction.delete: {
				if (!ASSetName || ASSetName.trim().length === 0) {
					throw new Error("ASSetName is required for deleting AS-Set");
				}

				this.task.objectMethod = ARIObjectMethod.delete;
				this.task.object = {
					path: `irr/as-set/${encodeURIComponent(ASSetName)}`,
				};

				const result = await this.executeTask();
				if (!result.isSuccess) {
					throw new Error(`Failed to delete ASSet: ${result.resultMessage}`);
				}
				break;
			}

			default:
				throw new Error(
					`Unsupported action for ASSet: ${this.task.objectAction}`
				);
		}

		return answer;
	}

	private async executeTask(): Promise<ARITaskResult> {
		if (!this.task) {
			throw new Error("No task defined");
		}

		if (!this.apiKey || this.apiKey.trim().length === 0) {
			throw new Error("API key is required");
		}

		if (this.task.objectType === undefined || this.task.object === undefined) {
			throw new Error("Object type and object information are required");
		}

		const { objectMethod, object, objectValue } = this.task;
		const requestURL = new URL(`${object.path}`, this.URL);

		requestURL.searchParams.append("apikey", this.apiKey);
		if (object.searchParams) {
			for (const [key, value] of Object.entries(object.searchParams)) {
				requestURL.searchParams.append(key, value);
			}
		}

		const headers = {
			"Content-Type": "application/xml",
			Accept: "application/xml",
		};

		axios.defaults.validateStatus = () => true;

		let response;

		try {
			switch (objectMethod) {
				case ARIObjectMethod.get:
					response = await axios.get(requestURL.toString(), {
						headers: {
							...headers,
						},
					});
					break;
				case ARIObjectMethod.post:
					response = await axios.post(
						requestURL.toString(),
						objectValue ?? "",
						{
							headers: {
								...headers,
							},
						}
					);
					break;
				case ARIObjectMethod.put:
					response = await axios.put(requestURL.toString(), objectValue ?? "", {
						headers: {
							...headers,
						},
					});
					break;
				case ARIObjectMethod.delete:
					response = await axios.delete(requestURL.toString(), {
						headers: {
							...headers,
						},
					});
					break;
				default:
					throw new Error(`Unsupported object method: ${objectMethod}`);
			}

			this.task = null;

			return {
				isSuccess: response.status >= 200 && response.status < 300,
				resultMessage: response.data,
			};
		} catch (e) {
			this.task = null;
			throw new Error(
				`Failed to execute task: ${e}, ${(requestURL.toString(), objectValue, response?.data)}`
			);
		}
	}
}

export default ARINIRM;

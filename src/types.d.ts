interface ARINPoc {
	handle: string;
}

interface ARINOrg {
	handle: string;
}

interface ARINPocLink {
	description: string;
	handle: ARINPoc;
	function: string;
}

interface ARIASSetOptions {
	ASSetName?: string;
	OrgHandle?: string;
	ASSetContent?: string;
}

type XMLString = string;

interface ARITask {
	objectType?: ARIObjectType;
	objectAction: ARIObejctAction;
	objectMethod?: ARIObjectMethod;
	object?: {
		path: string;
		searchParams?: Record<string, string>;
	};
	objectValue?: string;
}

interface ARITaskResult {
	isSuccess: boolean;
	resultMessage: XMLString;
}

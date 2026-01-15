import ASSet from "./core/construct/as_set";
import IRM from "./core/irm";
import asSetFromYaml from "./helper/SimpleASSet";
import fs from "fs";

const irm = new IRM(process.env.ARIN_API_KEY as string);

console.log("Fetching AS-Set list...");

const ASNList = await irm.list().as_set({
	OrgHandle: process.env.ARIN_ORG as string,
});

console.log(`Found ${ASNList.length} AS-Sets.`);

const existingFiles = fs.readdirSync("sync/as-sets");

ASNList.forEach(async (asSet) => {
	console.log(`Processing AS-Set: ${asSet.name}`);

	const asSetObjFromARIN = (
		await irm.view().as_set({
			ASSetName: asSet.name,
		})
	)[0];

	let asSetObj: ASSet = new ASSet();

	if (existingFiles.includes(`${asSet.name}.yaml`)) {
		console.log(
			`Found existing YAML file for ${asSet.name}, converting to detailed...`
		);
		const content = fs.readFileSync(`sync/as-sets/${asSet.name}.yaml`, "utf8");
		asSetObj = await asSetFromYaml(content);
	} else if (existingFiles.includes(`${asSet.name}.rpsl`)) {
		console.log(
			`Found existing RPSL file for ${asSet.name}, converting to detailed...`
		);
		const content = fs.readFileSync(`sync/as-sets/${asSet.name}.rpsl`, "utf8");
		asSetObj.fromRPSL(content);
	} else {
		console.log(`No existing file for ${asSet.name}, fetching details...`);
		asSetObj = asSetObjFromARIN;
		fs.writeFileSync(`sync/as-sets/${asSet.name}.rpsl`, asSetObj.toRPSL());
	}

	const setA = new Set(asSetObj.members);
	const setB = new Set(asSetObjFromARIN.members);

	const equal =
		setA.size === setB.size && Array.from(setA).every((v) => setB.has(v));

	if (equal) {
		console.log(`No changes for ${asSet.name}, skipping...`);
	} else {
		console.log(`Changes detected for ${asSet.name}:`);
		console.log(`Local Members: ${asSetObj.members}`);
		console.log(`ARIN Members: ${asSetObjFromARIN.members}`);
		console.log(`Updating ${asSet.name} on ARIN Server...`);
		const result = await irm.modify().as_set({
			ASSetName: asSetObj.name,
			ASSetContent: asSetObj.toXML(),
		});
		if (result.length === 1) {
			console.log(`Successfully updated ${asSet.name} on ARIN Server.`);
		}
	}

    return;
});

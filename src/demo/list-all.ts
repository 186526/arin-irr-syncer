import IRM from "../core/irm";
import fs from "fs";

const irm = new IRM(process.env.ARIN_API_Key as string);

const ASNList = await irm.list().as_set({
	OrgHandle: process.env.ARIN_ORG as string,
});

ASNList.forEach(async (asSet) => {
	const detailed = (
		await irm.view().as_set({
			ASSetName: asSet.name,
		})
	)[0];

	fs.writeFile(`./sync/${detailed.name}.rpsl`, detailed.toRPSL(), (err) => {
		if (err) {
			console.error(`Error writing file for ASSet ${detailed.name}:`, err);
		} else {
			console.log(`Successfully wrote file for ASSet ${detailed.name}`);
		}
	});
});

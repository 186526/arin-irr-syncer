import fs from "fs";
import irm from "../core/irm";
import ASSetFromYaml from "../helper/SimpleASSet";

const yamlText = fs.readFileSync("./output/AS-SUNOAKI.yaml", "utf8");
const asSet = await ASSetFromYaml(yamlText, {
	timeoutMs: 20000,
	onEmpty: "keep",
});

console.log("ASSet parsed from YAML:", asSet.toXML());

const IRM = new irm(process.env.ARIN_API_KEY || "");
IRM.modify()
	.as_set({
		ASSetName: asSet.name,
		ASSetContent: asSet.toXML(),
	})
	.then((result) => {
		console.log("ASSet modified:", result);
	})
	.catch((error) => {
		console.error("Error modifying ASSet:", error);
	});

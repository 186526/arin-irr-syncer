import fs from "fs";
import ASSet from "src/core/construct/as_set";

const rpslData = fs.readFileSync("./output/AS-EXAMPLE-ARIZ.rpsl", "utf-8");

const asSet = new ASSet();
asSet.fromRPSL(rpslData);

console.log("AS-Set Name:", asSet.name);
console.log("Members:", asSet.members);
console.log("Descriptions:", asSet.descriptions);
console.log("Remarks:", asSet.remarks);
console.log("Poc Links:", asSet.pocLinks);
console.log("Source:", asSet.source);

// Optionally, convert back to RPSL format
const rpslOutput = asSet.toRPSL();
console.log("RPSL Output:\n", rpslOutput);
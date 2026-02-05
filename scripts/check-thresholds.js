import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const reportsDir = path.resolve(__dirname, "..", "lighthouse-reports");

/*
  Adjust these thresholds for your business.
  These are realistic for a Shopify PDP.
*/
const thresholds = {
	performanceScore: 0.65,
	lcpMs: 4000,
	cls: 0.1,
	inpMs: 250,
};

let hasFailure = false;

const files = await readdir(reportsDir);
const jsonFiles = files.filter((file) => file.endsWith(".json"));

if (jsonFiles.length === 0) {
	console.error("No Lighthouse JSON reports found.");
}

for (const file of jsonFiles) {
	const filePath = path.join(reportsDir, file);
	const raw = await readFile(filePath, "utf8");
	const report = JSON.parse(raw);

	const performanceScore = report.categories.performance.score;

	const lcpAudit = report.audits["largest-contentful-paint"];
	const clsAudit = report.audits["cumulative-layout-shift"];
	// INP has had different audit IDs across Lighthouse versions.
	// Try the current stable ID first, then fall back to the experimental one.
	const inpAudit =
		report.audits["interaction-to-next-paint"] ??
		report.audits["experimental-interaction-to-next-paint"];

	const lcpMs = lcpAudit?.numericValue;
	const cls = clsAudit?.numericValue;
	const inpMs = inpAudit?.numericValue;

	console.log("Report:", file);
	console.log({
		performanceScore,
		lcpMs,
		cls,
		inpMs,
	});

	if (performanceScore < thresholds.performanceScore) {
		console.error("Performance score below threshold");
		hasFailure = true;
	}

	if (typeof lcpMs === "number" && lcpMs > thresholds.lcpMs) {
		console.error("LCP above threshold");
		hasFailure = true;
	}

	if (typeof cls === "number" && cls > thresholds.cls) {
		console.error("CLS above threshold");
		hasFailure = true;
	}

	if (typeof inpMs === "number" && inpMs > thresholds.inpMs) {
		console.error("INP above threshold");
		hasFailure = true;
	}
}

if (hasFailure) {
	console.error("One or more Lighthouse checks failed thresholds.");
} else {
	console.log("All Lighthouse thresholds passed.");
}

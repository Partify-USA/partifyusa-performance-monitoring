import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
  Edit this list.
  These should be real product pages you care about.
*/
const urls = [
	"https://partifyusa.com/products/dodge-ram-1500-1500-classic-2500-3500-capa-certified-driver-side-fender-ch1240269c?_pos=1&_psq=ch1240269c&_ss=e&_v=1.0",
	"https://partifyusa.com/products/subaru-impreza-wrx-wrx-sti-front-bumper-su1000167",
];

const outputDir = path.resolve(__dirname, "..", "lighthouse-reports");

await mkdir(outputDir, { recursive: true });

function runCommand(command) {
	return new Promise((resolve, reject) => {
		exec(command, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
			if (error) {
				console.error(stderr);
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

function makeSafeFileName(input) {
	return input
		.replace("https://", "")
		.replace("http://", "")
		.replace(/[^a-zA-Z0-9]/g, "_");
}

async function runLighthouseForUrl(url, preset) {
	const safeName = makeSafeFileName(url);
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

	const baseOutputPath = path.join(
		outputDir,
		`${safeName}-${preset}-${timestamp}`,
	);

	// Lighthouse's CLI presets do not support a value of "mobile".
	// Mobile is the default configuration, and "desktop" is an explicit preset.
	// We still use the preset name in the file for clarity, but only pass
	// --preset when it is a supported CLI value.
	const presetFlag = preset === "desktop" ? "--preset=desktop" : "";

	const command = [
		"npx lighthouse",
		`"${url}"`,
		"--quiet",
		"--throttling-method=simulate",
		presetFlag,
		"--chrome-flags='--headless --no-sandbox'",
		"--output=json",
		"--output=html",
		`--output-path="${baseOutputPath}"`,
	]
		.filter(Boolean)
		.join(" ");

	console.log(`Running Lighthouse (${preset}) for ${url}`);

	await runCommand(command);
}

for (const url of urls) {
	await runLighthouseForUrl(url, "mobile");
	await runLighthouseForUrl(url, "desktop");
}

console.log("All Lighthouse runs completed.");

import { exec } from "node:child_process";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/*
  Edit this list.
  These should be real product pages you care about.
*/
const urls = [
	"https://partifyusa.com/products/dodge-ram-1500-1500-classic-2500-3500-capa-certified-driver-side-fender-ch1240269c?_pos=1&_psq=ch1240269c&_ss=e&_v=1.0",
	// "https://partifyusa.com/products/subaru-impreza-wrx-wrx-sti-front-bumper-su1000167",
];

const outputDir = path.resolve(__dirname, "..", "lighthouse-reports");

await mkdir(outputDir, { recursive: true });

async function cleanupOldJsonReports() {
	try {
		const files = await readdir(outputDir);
		await Promise.all(
			files
				.filter((file) => file.endsWith(".json"))
				.map((file) => rm(path.join(outputDir, file), { force: true })),
		);
	} catch (error) {
		if (!(error && error.code === "ENOENT")) {
			throw error;
		}
	}
}

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

async function getFinalUrl(url) {
	console.log(`Checking for redirects: ${url}`);
	const browser = await puppeteer.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	});
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: "networkidle0" });
	const finalUrl = page.url();
	await browser.close();

	if (finalUrl !== url) {
		console.log(`  → Redirected to: ${finalUrl}`);
	} else {
		console.log(`  → No redirect detected`);
	}

	return finalUrl;
}

async function runLighthouseForUrl(url, preset) {
	// Get the post-redirect URL to ensure consistent testing
	const finalUrl = await getFinalUrl(url);
	const safeName = makeSafeFileName(finalUrl);
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
		`"${finalUrl}"`,
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

	console.log(`Running Lighthouse (${preset}) for ${finalUrl}`);

	await runCommand(command);
}

await cleanupOldJsonReports();

for (const url of urls) {
	await runLighthouseForUrl(url, "mobile");
	await runLighthouseForUrl(url, "desktop");
}

console.log("All Lighthouse runs completed.");

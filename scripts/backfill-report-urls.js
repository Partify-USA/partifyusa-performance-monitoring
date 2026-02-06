import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "lighthouse-reports");
const historyPath = path.join(rootDir, "history", "lighthouse-history.json");

function parseReportFile(file) {
	let page = file;
	let preset = "";

	for (const candidate of ["mobile", "desktop"]) {
		const marker = `-${candidate}-`;
		const idx = file.indexOf(marker);
		if (idx !== -1) {
			preset = candidate;
			const safePart = file.slice(0, idx);
			page = safePart.replace(/_/g, " ");
			break;
		}
	}

	return { page, preset };
}

async function buildHtmlIndex() {
	let files;
	try {
		files = await readdir(reportsDir);
	} catch (error) {
		if (error && error.code === "ENOENT") {
			console.log(
				"No lighthouse-reports directory found; nothing to backfill.",
			);
			return [];
		}
		throw error;
	}
	const htmlFiles = files.filter((f) => f.endsWith(".html"));

	const index = [];

	for (const file of htmlFiles) {
		try {
			const jsonCandidate = file
				.replace(/\.report\.html$/i, ".report.json")
				.replace(/\.html$/i, ".json");

			// Read JSON report to get fetchTime
			const jsonPath = path.join(reportsDir, jsonCandidate);
			const raw = await readFile(jsonPath, "utf8");
			const report = JSON.parse(raw);

			const fetchTime =
				report.lighthouseResult?.fetchTime ?? report.fetchTime ?? null;

			const parsed = parseReportFile(file);

			index.push({
				page: parsed.page,
				preset: parsed.preset,
				fetchTime,
				reportUrl: `lighthouse-reports/${file}`,
			});
		} catch {
			// Ignore if matching JSON is missing or malformed
		}
	}

	return index;
}

async function backfill() {
	let history;
	try {
		const raw = await readFile(historyPath, "utf8");
		history = JSON.parse(raw);
		if (!Array.isArray(history)) {
			console.error("History file is not an array; aborting.");
			return;
		}
	} catch (error) {
		console.error("Failed to read history file:", error);
		return;
	}

	const index = await buildHtmlIndex();

	let updatedCount = 0;

	for (const entry of history) {
		if (entry.reportUrl) continue;
		if (!entry.page || !entry.preset || !entry.fetchTime) continue;

		const match = index.find(
			(i) =>
				i.page === entry.page &&
				i.preset === entry.preset &&
				i.fetchTime === entry.fetchTime,
		);

		if (match) {
			entry.reportUrl = match.reportUrl;
			updatedCount += 1;
		}
	}

	if (updatedCount === 0) {
		console.log("No entries needed backfilling.");
		return;
	}

	await writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");
	console.log(`Backfilled reportUrl for ${updatedCount} history entries.`);
}

await backfill();

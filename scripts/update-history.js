import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "lighthouse-reports");
const historyDir = path.join(rootDir, "history");
const historyPath = path.join(historyDir, "lighthouse-history.json");

const runId = process.env.GITHUB_RUN_ID ?? null;
const runNumber = process.env.GITHUB_RUN_NUMBER
	? Number(process.env.GITHUB_RUN_NUMBER)
	: null;
const runUrl = process.env.GITHUB_RUN_URL ?? null;

async function readExistingHistory() {
	try {
		const raw = await readFile(historyPath, "utf8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch (error) {
		if (error && error.code === "ENOENT") return [];
		throw error;
	}
}

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

async function collectCurrentRun() {
	let files;
	try {
		files = await readdir(reportsDir);
	} catch (error) {
		if (error && error.code === "ENOENT") return [];
		throw error;
	}

	const jsonFiles = files.filter((file) => file.endsWith(".json"));
	const entries = [];

	for (const file of jsonFiles) {
		try {
			const jsonPath = path.join(reportsDir, file);
			const raw = await readFile(jsonPath, "utf8");
			const report = JSON.parse(raw);

			const categories = report.categories ?? {};
			const perf = categories.performance?.score ?? null;
			const acces = categories.accessibility?.score ?? null;
			const bp = categories["best-practices"]?.score ?? null;
			const seo = categories.seo?.score ?? null;

			const fetchTime =
				report.lighthouseResult?.fetchTime ?? report.fetchTime ?? null;

			const parsed = parseReportFile(file);

			entries.push({
				runId,
				runNumber,
				runUrl,
				page: parsed.page,
				preset: parsed.preset,
				fetchTime,
				metrics: {
					performance: perf,
					accessibility: acces,
					bestPractices: bp,
					seo,
				},
			});
		} catch {
			// Ignore malformed JSON or missing fields.
		}
	}

	return entries;
}

async function main() {
	const existing = await readExistingHistory();
	const current = await collectCurrentRun();

	if (current.length === 0) {
		return;
	}

	const combined = existing.concat(current);

	await mkdir(historyDir, { recursive: true });
	await writeFile(historyPath, JSON.stringify(combined, null, 2), "utf8");
}

await main();

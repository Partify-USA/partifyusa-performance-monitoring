import { readdir, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "lighthouse-reports");
const siteDir = path.join(rootDir, "site");
const existingSiteDir = process.env.EXISTING_SITE_DIR
	? path.resolve(rootDir, process.env.EXISTING_SITE_DIR)
	: null;
const runId = process.env.GITHUB_RUN_ID ?? "local";

async function getHtmlReports() {
	try {
		const files = await readdir(reportsDir);
		return files.filter((file) => file.endsWith(".html"));
	} catch (error) {
		if (error && error.code === "ENOENT") {
			console.error(
				"No lighthouse-reports directory found. Skipping dashboard generation.",
			);
			return [];
		}
		throw error;
	}
}

function parseReportFile(file) {
	// Example file name pattern from run-lighthouse:
	//   safeName-preset-timestamp.report.html
	// We want to extract:
	//   page (derived from safeName)
	//   preset (mobile/desktop)
	//   timestamp (string)

	const href = `lighthouse-reports/${file}`;

	let page = file;
	let preset = "";
	let timestamp = "";

	for (const candidate of ["mobile", "desktop"]) {
		const marker = `-${candidate}-`;
		const idx = file.indexOf(marker);
		if (idx !== -1) {
			preset = candidate;
			const safePart = file.slice(0, idx);
			const rest = file.slice(idx + marker.length);
			// Strip trailing suffix like .report.html for display.
			const ts = rest.replace(/\.report\.html$/i, "").replace(/\.html$/i, "");

			page = safePart.replace(/_/g, " ");
			timestamp = ts;
			break;
		}
	}

	return { href, page, preset, timestamp, file };
}

async function buildDashboard() {
	const htmlFiles = await getHtmlReports();

	// Start from any existing site (from previous runs) so we keep history.
	if (existingSiteDir) {
		try {
			await mkdir(siteDir, { recursive: true });
			await cp(existingSiteDir, siteDir, { recursive: true });
		} catch (error) {
			if (!(error && error.code === "ENOENT")) {
				throw error;
			}
		}
	} else {
		await mkdir(siteDir, { recursive: true });
	}

	if (htmlFiles.length === 0) {
		const emptyHtml = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<title>Lighthouse Dashboard</title>
	<style>
		body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; }
		h1 { margin-bottom: 1rem; }
		p { color: #555; }
	</style>
</head>
<body>
	<h1>Lighthouse Dashboard</h1>
	<p>No Lighthouse HTML reports were found for this run.</p>
</body>
</html>`;

		await writeFile(path.join(siteDir, "index.html"), emptyHtml, "utf8");
		return;
	}

	// Copy current run's reports into a run-specific folder under site/runs/<runId>/
	const runDir = path.join(siteDir, "runs", runId, "lighthouse-reports");
	await mkdir(runDir, { recursive: true });
	await cp(reportsDir, runDir, { recursive: true });

	// Collect all report entries across all runs.
	const runsRoot = path.join(siteDir, "runs");
	const runIds = await readdir(runsRoot);
	const allEntries = [];

	for (const id of runIds) {
		const reportsPath = path.join(runsRoot, id, "lighthouse-reports");
		let files;
		try {
			files = await readdir(reportsPath);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".html")) continue;
			const info = parseReportFile(file);
			allEntries.push({
				...info,
				runId: id,
				href: `runs/${id}/lighthouse-reports/${file}`,
			});
		}
	}

	// Sort newest first by run and file.
	allEntries.sort((a, b) => {
		if (a.runId === b.runId) return b.file.localeCompare(a.file);
		return b.runId.localeCompare(a.runId);
	});

	const rows = allEntries
		.map((entry) => {
			const presetLabel = entry.preset ? entry.preset : "";
			const timestampLabel = entry.timestamp ? entry.timestamp : "";
			return `<tr>
				<td>${entry.runId}</td>
				<td>${entry.page}</td>
				<td>${presetLabel}</td>
				<td>${timestampLabel}</td>
				<td><a href="${entry.href}">View report</a></td>
			</tr>`;
		})
		.join("\n");

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<title>Lighthouse Dashboard</title>
	<style>
		body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; background: #0b1120; color: #e5e7eb; }
		h1 { margin-bottom: 0.5rem; }
		p.subtitle { margin-top: 0; margin-bottom: 1.5rem; color: #9ca3af; }
		table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: #020617; border-radius: 0.5rem; overflow: hidden; }
		th, td { padding: 0.75rem 1rem; text-align: left; }
		th { background: #111827; font-weight: 600; border-bottom: 1px solid #1f2937; }
		tr:nth-child(even) { background: #020617; }
		tr:nth-child(odd) { background: #030712; }
		a { color: #38bdf8; text-decoration: none; }
		a:hover { text-decoration: underline; }
	</style>
</head>
<body>
	<h1>Lighthouse Dashboard</h1>
	<p class="subtitle">History of Lighthouse reports for all monitored URLs.</p>
	<table>
		<thead>
			<tr>
				<th>Run</th>
				<th>Page</th>
				<th>Preset</th>
				<th>Timestamp</th>
				<th>Report</th>
			</tr>
		</thead>
		<tbody>
${rows}
		</tbody>
	</table>
</body>
</html>`;

	await writeFile(path.join(siteDir, "index.html"), html, "utf8");
}

await buildDashboard();

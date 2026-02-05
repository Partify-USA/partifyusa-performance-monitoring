import { readdir, mkdir, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..");
const reportsDir = path.join(rootDir, "lighthouse-reports");
const siteDir = path.join(rootDir, "site");

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

	await mkdir(siteDir, { recursive: true });

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

	// Copy reports into the site directory so they can be served by Pages.
	await mkdir(path.join(siteDir, "lighthouse-reports"), { recursive: true });
	await cp(reportsDir, path.join(siteDir, "lighthouse-reports"), {
		recursive: true,
	});

	const entries = htmlFiles.map(parseReportFile);

	// Sort newest first by timestamp/file name.
	entries.sort((a, b) => b.file.localeCompare(a.file));

	const rows = entries
		.map((entry) => {
			const presetLabel = entry.preset ? entry.preset : "";
			const timestampLabel = entry.timestamp ? entry.timestamp : "";
			return `<tr>
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
	<p class="subtitle">Latest Lighthouse reports for monitored URLs.</p>
	<table>
		<thead>
			<tr>
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

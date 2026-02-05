import { readdir, mkdir, cp, writeFile, readFile } from "node:fs/promises";
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
	const series = [];

	for (const id of runIds) {
		const reportsPath = path.join(runsRoot, id, "lighthouse-reports");
		let files;
		try {
			files = await readdir(reportsPath);
		} catch {
			continue;
		}
		for (const file of files) {
			if (file.endsWith(".html")) {
				const info = parseReportFile(file);
				allEntries.push({
					...info,
					runId: id,
					href: `runs/${id}/lighthouse-reports/${file}`,
				});
			} else if (file.endsWith(".json")) {
				try {
					const jsonPath = path.join(reportsPath, file);
					const raw = await readFile(jsonPath, "utf8");
					const report = JSON.parse(raw);

					const categories = report.categories ?? {};
					const perf = categories.performance?.score ?? null;
					const acces = categories.accessibility?.score ?? null;
					const bp = categories["best-practices"]?.score ?? null;
					const seo = categories.seo?.score ?? null;

					// Use Lighthouse fetchTime if available, otherwise fall back to file name.
					const fetchTime =
						report.lighthouseResult?.fetchTime ?? report.fetchTime ?? null;

					const parsed = parseReportFile(file.replace(/\.json$/i, ".html"));

					series.push({
						runId: id,
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
					// Ignore malformed JSON or missing fields for trend data.
				}
			}
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

	<section id="charts">
		<h2>Trends</h2>
		<p class="subtitle">Select a page, preset, and metric to view score trends over time.</p>
		<div style="margin-bottom: 1rem; display: flex; gap: 0.75rem; flex-wrap: wrap;">
			<label>Page
				<select id="pageSelect"></select>
			</label>
			<label>Preset
				<select id="presetSelect"></select>
			</label>
			<label>Metric
				<select id="metricSelect">
					<option value="performance">Performance</option>
					<option value="accessibility">Accessibility</option>
					<option value="bestPractices">Best Practices</option>
					<option value="seo">SEO</option>
				</select>
			</label>
		</div>
		<canvas id="trendChart" height="120"></canvas>
	</section>

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

	<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" integrity="sha256-YoJtQW9vZpaMnQ7tHWCkug4J3yoHgZ2d2jlK0PG2lws=" crossorigin="anonymous"></script>
	<script id="lh-data" type="application/json">${JSON.stringify(series)}<\/script>
	<script>
	(function() {
		const raw = document.getElementById("lh-data").textContent;
		let data = [];
		try {
			data = JSON.parse(raw);
		} catch {}
		if (!Array.isArray(data) || data.length === 0) return;

		// Normalize and sort by time within each series.
		for (const d of data) {
			if (d.fetchTime) {
				d._ts = Date.parse(d.fetchTime) || null;
			} else {
				d._ts = null;
			}
		}

		const pages = [...new Set(data.map((d) => d.page))].sort();
		const presets = [...new Set(data.map((d) => d.preset).filter(Boolean))].sort();

		const pageSelect = document.getElementById("pageSelect");
		const presetSelect = document.getElementById("presetSelect");
		const metricSelect = document.getElementById("metricSelect");

		pages.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			pageSelect.appendChild(opt);
		});

		presets.forEach((p) => {
			const opt = document.createElement("option");
			opt.value = p;
			opt.textContent = p;
			presetSelect.appendChild(opt);
		});

		if (pages.length) pageSelect.value = pages[0];
		if (presets.length) presetSelect.value = presets[0];

		const ctx = document.getElementById("trendChart");
		let chart;

		function updateChart() {
			const page = pageSelect.value;
			const preset = presetSelect.value;
			const metric = metricSelect.value;

			let seriesPoints = data.filter(
				(d) => d.page === page && d.preset === preset && d.metrics[metric] != null,
			);

			seriesPoints = seriesPoints
				.filter((d) => d._ts != null)
				.sort((a, b) => a._ts - b._ts);

			const labels = seriesPoints.map((d) => new Date(d._ts).toLocaleString());
			const values = seriesPoints.map((d) => (d.metrics[metric] || 0) * 100);

			const metricLabelMap = {
				performance: "Performance",
				accessibility: "Accessibility",
				bestPractices: "Best Practices",
				seo: "SEO",
			};

			// Thresholds are expressed as 0-100 scores.
			const metricThresholdMap = {
				performance: 90,
				accessibility: 90,
				bestPractices: 90,
				seo: 90,
			};

			const label = (metricLabelMap[metric] || metric) +
				" score for " +
				page +
				" (" +
				preset +
				")";

			const thresholdValue = metricThresholdMap[metric];

			if (chart) chart.destroy();

			const datasets = [
				{
					label,
					data: values,
					borderColor: "#38bdf8",
					backgroundColor: "rgba(56, 189, 248, 0.2)",
					tension: 0.25,
					pointRadius: 3,
				},
			];

			if (typeof thresholdValue === "number") {
				const thresholdData = labels.map(() => thresholdValue);
				datasets.push({
					label:
						(metricLabelMap[metric] || metric) +
						" threshold (" + thresholdValue + ")",
					data: thresholdData,
					borderColor: "#f97316",
					borderDash: [6, 4],
					pointRadius: 0,
					fill: false,
				});
			}

			chart = new Chart(ctx, {
				type: "line",
				data: {
					labels,
					datasets,
				},
				options: {
					responsive: true,
					plugins: {
						legend: { labels: { color: "#e5e7eb" } },
					},
					scales: {
						x: {
							ticks: { color: "#9ca3af" },
							grid: { color: "#1f2937" },
						},
						y: {
							min: 0,
							max: 100,
							ticks: { color: "#9ca3af" },
							grid: { color: "#1f2937" },
						},
					},
				},
			});
		}

		pageSelect.addEventListener("change", updateChart);
		presetSelect.addEventListener("change", updateChart);
		metricSelect.addEventListener("change", updateChart);

		updateChart();
	})();
	</script>
</body>
</html>`;

	await writeFile(path.join(siteDir, "index.html"), html, "utf8");
}

await buildDashboard();

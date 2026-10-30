import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../.github/workflows/public-availability.yml', import.meta.url), 'utf8'
);

test('scheduled public availability is a low-frequency read-only workflow, not a second deploy', () => {
  assert.ok(workflow.includes("cron: '19 */6 * * *'"));
  assert.ok(workflow.includes('workflow_dispatch:'));
  assert.ok(workflow.includes('contents: read'));
  assert.ok(workflow.includes('timeout-minutes: 3'));
  assert.ok(workflow.includes('cancel-in-progress: true'));
  assert.ok(!workflow.includes('workflow_run:'));
  assert.ok(!workflow.includes('push:'));
  assert.ok(!workflow.includes('pull_request:'));
  assert.ok(!workflow.includes('docker compose'));
  assert.ok(!workflow.includes('DEPLOY_HOST'));
  assert.ok(!workflow.includes('secrets.'));
});

test('scheduled probes retain real HTTPS TLS and identify intermittent versus persistent CDN failures', () => {
  assert.ok(workflow.includes("for route in / /zh/ /merge-pdf/ /zh/merge-pdf/ /robots.txt /sitemap-index.xml /pdfjs/pdf.worker.min.mjs; do"));
  assert.ok(workflow.includes('for attempt in 1 2; do'));
  assert.ok(workflow.includes('https://pdf.plainmile.com'));
  assert.ok(workflow.includes('--connect-timeout 4 --max-time 9'));
  assert.ok(workflow.includes("if [ \"$status\" = 200 ]; then"));
  assert.ok(workflow.includes('if [ "$good" -eq 0 ]; then'));
  assert.ok(workflow.includes('if [ "$failed_routes" -gt 0 ]; then'));
  assert.ok(workflow.includes('cf_ray='));
  assert.ok(workflow.includes("grep -im1 '^cf-ray:'"));
  assert.ok(!workflow.includes('--insecure'));
  assert.ok(!workflow.includes('curl -k'));
  assert.ok(!workflow.includes('-X POST'));
  assert.ok(!workflow.includes('npm install'));
});

test('HTTP 200 only counts when curl completes the entire transfer successfully', () => {
  // curl can report http_code=200 and still exit 18 (truncated response) or
  // 28 (timeout after headers). Do not suppress that exit and mark the
  // sampled public route healthy just because response headers arrived.
  assert.ok(workflow.includes('curl_exit=0'));
  assert.ok(workflow.includes(') || curl_exit=$?'));
  assert.ok(workflow.includes('if [ "$status" = 200 ] && [ "$curl_exit" -eq 0 ]; then'));
  assert.ok(workflow.includes('curl_exit=$curl_exit'));
  assert.ok(!workflow.includes('"https://pdf.plainmile.com${route}" 2>/dev/null || true)'));
});

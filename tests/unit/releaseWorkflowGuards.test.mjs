import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readWorkflow(filename) {
  return readFileSync(new URL(`../../.github/workflows/${filename}`, import.meta.url), 'utf8');
}

test('production and CI must install a real committed npm v3 lockfile, not floating versions', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.name, packageJson.name);
  assert.deepEqual(lock.packages[''].dependencies, packageJson.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies, packageJson.devDependencies);
  assert.ok(Object.keys(lock.packages).length > 200, 'the transitive npm tree must be resolved');
  for (const essential of [
    'node_modules/astro',
    'node_modules/@astrojs/react',
    'node_modules/pdf-lib',
    'node_modules/pdfjs-dist',
    'node_modules/jszip',
    'node_modules/react',
  ]) {
    assert.ok(lock.packages[essential]?.version, 'missing resolved ' + essential);
    assert.ok(lock.packages[essential]?.integrity, 'missing npm integrity for ' + essential);
  }
  assert.equal(lock.packages['node_modules/pdfjs-dist'].version, '6.3.289');
  const docker = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const ci = readWorkflow('ci.yml');
  assert.match(docker, /^RUN npm ci --no-audit --no-fund$/m);
  assert.match(ci, /npm ci --no-audit --no-fund; npm run test:unit; npm run build/);
  assert.doesNotMatch(docker, /npm install|else npm ci|else npm install/);
  assert.doesNotMatch(ci, /else npm install/);
});

test('PR CI has exactly one required check per feature SHA; main push still runs release gate', () => {
  const yaml = readWorkflow('ci.yml');
  const trigger = yaml.split(/^permissions:/m)[0];
  assert.match(trigger, /on:\s*\n  push:\s*\n    branches:\s*\n      - main\s*\n  pull_request:\s*\n    branches:\s*\n      - main/);
  assert.doesNotMatch(trigger, /feature\/\*\*/);
  assert.match(yaml, /test-build-e2e:/);
  assert.match(yaml, /cancel-in-progress: true/);
});

test('only main-branch CI can trigger an image publish workflow run', () => {
  const yaml = readWorkflow('publish.yml');
  const trigger = yaml.split(/^permissions:/m)[0];
  assert.match(trigger, /workflow_run:\s*\n/);
  assert.match(trigger, /^ {4}branches: \[main\]$/m);
  assert.match(trigger, /PDF Tools CI/);
  assert.match(yaml, /workflow_run\.conclusion == 'success'/);
  assert.match(yaml, /workflow_run\.event == 'push'/);
  assert.match(yaml, /workflow_run\.head_branch == 'main'/);
  assert.match(yaml, /github\.sha == github\.event\.workflow_run\.head_sha/);
});

test('image publication serializes the mutable latest tag and rechecks main after queuing', () => {
  const yaml = readWorkflow('publish.yml');
  assert.match(yaml, /concurrency:\s*\n(?:\s*#.*\n)*\s+group: pdf-tools-publish-main\s*\n\s+cancel-in-progress: false/);
  assert.match(yaml, /id: main-head/);
  assert.match(yaml, /repos\/plainmile\/pdf-tools\/branches\/main/);
  assert.match(yaml, /jq -er '\.commit\.sha'/);
  assert.match(yaml, /if \[ "\$current_sha" = "\$EXPECTED_SHA" \]/);
  assert.match(yaml, /current=false/);
  assert.match(yaml, /- name: Docker login\n\s+if: steps\.main-head\.outputs\.current == 'true'/);
  assert.match(yaml, /- name: Publish commit-pinned image\n\s+if: steps\.main-head\.outputs\.current == 'true'/);
});

test('only main-branch Publish Image completion can trigger deployment', () => {
  const yaml = readWorkflow('deploy.yml');
  const trigger = yaml.split(/^permissions:/m)[0];
  assert.match(trigger, /workflow_run:\s*\n/);
  assert.match(trigger, /^ {4}branches: \[main\]$/m);
  assert.match(trigger, /Publish Image/);
  assert.match(yaml, /workflow_run\.conclusion == 'success'/);
  assert.match(yaml, /workflow_run\.head_branch == 'main'/);
  assert.match(yaml, /github\.sha == github\.event\.workflow_run\.head_sha/);
  assert.match(yaml, /IMAGE_TAG: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
});

test('production Compose deployment uses /opt/compose/pdf-tools and safely migrates only if missing', () => {
  const yaml = readWorkflow('deploy.yml');
  const docs = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  const agentPolicy = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

  // The legacy path is referenced only as the conditional migration source.
  assert.match(yaml, /if \[ ! -e \/opt\/compose\/pdf-tools \] && \[ -d \/opt\/data\/compose\/pdf-tools \]/);
  assert.match(yaml, /mv \/opt\/data\/compose\/pdf-tools \/opt\/compose\/pdf-tools/);
  assert.match(yaml, /\[ -L \/opt\/compose\/pdf-tools \]/);
  assert.doesNotMatch(yaml, /cd \/opt\/data\/compose\/pdf-tools/);
  assert.match(yaml, /cd \/opt\/compose\/pdf-tools/);
  assert.match(yaml, /:\/opt\/compose\/pdf-tools\/compose\.prod\.yaml/);
  assert.doesNotMatch(yaml, /:\/opt\/data\/compose\/pdf-tools\/compose\.prod\.yaml/);

  // Health requires the container's Compose working-directory label to match.
  assert.match(yaml, /com\.docker\.compose\.project\.working_dir/);
  assert.match(yaml, /\[ "\$working_dir" != \/opt\/compose\/pdf-tools \]/);
  assert.match(yaml, /docker network inspect edge/);
  assert.match(yaml, /docker compose -f compose\.prod\.yaml up -d/);
  assert.match(yaml, /if \[ "\$image" != "ghcr\.io\/plainmile\/pdf-tools:\$IMAGE_TAG" \]; then/);

  assert.match(docs, /deployment uses `\/opt\/compose\/pdf-tools\/`/);
  assert.match(docs, /cd \/opt\/compose\/pdf-tools/);
  // The production file is not one of Docker Compose's default auto-discovered names.
  for (const command of ['ps', 'pull', 'up -d']) {
    assert.ok(docs.includes('sudo docker compose -f compose.prod.yaml ' + command));
    assert.ok(!docs.includes('sudo docker compose ' + command));
  }
  assert.match(agentPolicy, /must live in `\/opt\/compose\/pdf-tools\/`/);
});

test('public image pull is verified and production never uses stale GHCR credentials or changes desired state before pull', () => {
  const deploy = readWorkflow('deploy.yml');
  const publish = readWorkflow('publish.yml');
  assert.match(publish, /- name: Verify published image allows an anonymous pull/);
  assert.match(publish, /DOCKER_CONFIG="\$anonymous_docker_config" docker manifest inspect/);
  assert.match(publish, /Set the package visibility to Public/);
  const deployStep = deploy.split('- name: Deploy the exact published image and check its health')[1]
    ?.split('- name: Diagnose origin certificate and local proxy')[0];
  assert.ok(deployStep);
  assert.match(deployStep, /anonymous_docker_config=\$\(mktemp -d\)/);
  assert.match(deployStep, /trap 'rm -rf -- "\$anonymous_docker_config"' EXIT/);
  assert.match(deployStep, /DOCKER_CONFIG="\$anonymous_docker_config" docker pull "ghcr\.io\/plainmile\/pdf-tools:\$IMAGE_TAG"/);
  assert.match(deployStep, /docker compose -f compose\.prod\.yaml up -d --pull never/);
  assert.ok(deployStep.indexOf('docker pull "ghcr.io/plainmile/pdf-tools:$IMAGE_TAG"')
    < deployStep.indexOf("printf 'IMAGE_TAG=%s\\n'"));
  assert.doesNotMatch(deploy, /docker logout ghcr.io/);
  assert.doesNotMatch(deploy, /docker system prune|docker image prune/);
});

test('production probes exact published SHA instead of copy that SEO updates can legitimately change', () => {
  const docker = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const nginx = readFileSync(new URL('../../deploy/nginx.conf', import.meta.url), 'utf8');
  const publish = readWorkflow('publish.yml');
  const deploy = readWorkflow('deploy.yml');
  const ci = readWorkflow('ci.yml');
  const publicProbe = deploy.split('- name: Verify public HTTPS, exact release SHA, SEO and worker')[1]
    ?.split('- name: Public browser release smoke and SEO against deployed site')[0];

  assert.ok(publicProbe, 'immutable SHA public deployment verification step required');
  assert.match(docker, /ARG SOURCE_SHA=development/);
  assert.match(docker, /printf '%s\\n' "\$SOURCE_SHA" > \/usr\/share\/nginx\/html\/\.well-known\/plainmile-release/);
  assert.match(nginx, /location = \/\.well-known\/plainmile-release/);
  assert.match(nginx, /location = \/\.well-known\/plainmile-release \{[\s\S]*?expires -1;/);
  assert.match(nginx, /location = \/\.well-known\/plainmile-release \{[\s\S]*?X-Robots-Tag "noindex, nofollow"/);
  assert.match(ci, /x-robots-tag: noindex/);
  assert.match(publish, /SOURCE_SHA=\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(ci, /docker build --build-arg SOURCE_SHA="\$GITHUB_SHA"/);
  assert.match(ci, /grep -q 'lang="zh-CN"' dist\/zh\/index\.html/);
  assert.doesNotMatch(ci, /grep -q '整理 PDF 页面'/);
  assert.match(ci, /\.well-known\/plainmile-release\)" = "\$GITHUB_SHA"/);

  assert.match(publicProbe, /EXPECTED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(publicProbe, /\.well-known\/plainmile-release\?sha=\$EXPECTED_SHA/);
  assert.match(publicProbe, /if \[ "\$deployed_sha" != "\$EXPECTED_SHA" \]; then/);
  assert.match(publicProbe, /grep -q 'rel="canonical"'/);
  assert.match(publicProbe, /grep -q 'hreflang="zh-CN"'/);
  assert.doesNotMatch(publicProbe, /Your documents|Work with PDF pages|自由整理每一页|<h1>/);
});

test('bounded PUBLIC verification retains complete SEO, real file outputs, safe rollback and full no-retry Docker CI', () => {
  const deploy = readWorkflow('deploy.yml');
  const ci = readWorkflow('ci.yml');
  const deployConfig = readFileSync(new URL('../../playwright.deploy.config.mjs', import.meta.url), 'utf8');
  const smoke = readFileSync(new URL('../e2e/public-release-smoke.spec.mjs', import.meta.url), 'utf8');
  const publicStep = deploy.split('- name: Public browser release smoke and SEO against deployed site')[1]
    ?.split('- name: Restore last healthy image if release checks fail')[0];
  assert.ok(publicStep, 'public deployment must run the bounded release tests');
  assert.match(publicStep, /timeout-minutes: 10/);
  assert.match(publicStep, /PDF_BASE_URL=https:\/\/pdf\.plainmile\.com/);
  assert.match(publicStep, /npx playwright test --config=playwright\.deploy\.config\.mjs --reporter=list --retries=1/);
  assert.match(publicStep, /cp -r test-results \/artifacts\//);
  assert.match(deployConfig, /public\.spec\.mjs/);
  assert.match(deployConfig, /public-release-smoke\.spec\.mjs/);
  assert.match(deployConfig, /retries: 0/);
  assert.match(deployConfig, /globalTimeout: 8 \* 60 \* 1000/);
  for (const coverage of ['public merge:', 'public Chinese split:', 'public image converter:',
    'public mobile Chinese PDF-to-TXT', 'public drag-and-drop PDF',
    'public drag-and-drop text', 'public long PDF final batch']) {
    assert.ok(smoke.includes(coverage), 'missing real release coverage: ' + coverage);
  }
  assert.match(ci, /npx playwright test --config=playwright\.cross-browser\.config\.mjs/);
  assert.match(ci, /npx playwright test\s*\n/);
  assert.match(ci, /npx playwright test --config=playwright\.deploy\.config\.mjs/);
  assert.doesNotMatch(ci, /--retries=/);
});

test('failed public E2E or unhealthy deploy rolls back only this service to a previously healthy SHA', () => {
  const yaml = readWorkflow('deploy.yml');
  const checkpoint = yaml.indexOf('id: checkpoint');
  const deploy = yaml.indexOf('id: deploy');
  const publicE2E = yaml.indexOf('- name: Public browser release smoke and SEO against deployed site');
  const rollback = yaml.indexOf('- name: Restore last healthy image if release checks fail');
  assert.ok(checkpoint > 0 && checkpoint < deploy && deploy < publicE2E && publicE2E < rollback);
  // Never trust a stale .env; only a healthy, correctly owned running image.
  assert.match(yaml, /image=\$\(docker inspect -f '\{\{\.Config\.Image\}\}' plainmile-pdf-tools/);
  assert.match(yaml, /if \[ "\$health" = healthy \] && \[ "\$working_dir" = \/opt\/compose\/pdf-tools \]/);
  assert.match(yaml, /case "\$image" in[\s\S]*?ghcr\.io\/plainmile\/pdf-tools:\*/);
  assert.match(yaml, /printf 'previous_sha=%s\\n' "\$previous_sha" >> "\$GITHUB_OUTPUT"/);
  // Only rollback on actual failure, after deploy was attempted, with a safe checkpoint.
  assert.match(yaml, /if: \$\{\{ failure\(\) && steps\.checkpoint\.outputs\.previous_sha != '' && steps\.deploy\.outcome != 'skipped' \}\}/);
  assert.match(yaml, /PREVIOUS_SHA: \$\{\{ steps\.checkpoint\.outputs\.previous_sha \}\}/);
  assert.match(yaml, /FAILED_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(yaml, /if ! grep -qx "IMAGE_TAG=\$FAILED_SHA" \.env; then/);
  assert.match(yaml, /if \[ -n "\$working_dir" \] && \[ "\$working_dir" != \/opt\/compose\/pdf-tools \]; then/);
  assert.match(yaml, /printf 'IMAGE_TAG=%s\\n' "\$PREVIOUS_SHA" > \.env/);
  assert.match(yaml, /docker compose -f compose\.prod\.yaml up -d/);
  assert.match(yaml, /if \[ "\$working_dir" = \/opt\/compose\/pdf-tools \] &&[\s\S]*?\[ "\$image" = "ghcr\.io\/plainmile\/pdf-tools:\$PREVIOUS_SHA" \]; then/);
  // Rollback must never restart the VPS edge, touch other Compose stacks or prune images.
  assert.doesNotMatch(yaml, /docker compose down|docker system prune|docker image prune/);
});

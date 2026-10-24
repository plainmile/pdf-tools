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

test('failed public E2E or unhealthy deploy rolls back only this service to a previously healthy SHA', () => {
  const yaml = readWorkflow('deploy.yml');
  const checkpoint = yaml.indexOf('id: checkpoint');
  const deploy = yaml.indexOf('id: deploy');
  const publicE2E = yaml.indexOf('- name: Public browser E2E and SEO against deployed site');
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

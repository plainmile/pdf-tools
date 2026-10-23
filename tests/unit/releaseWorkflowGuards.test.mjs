import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readWorkflow(filename) {
  return readFileSync(new URL(`../../.github/workflows/${filename}`, import.meta.url), 'utf8');
}

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

  assert.match(docs, /deployment uses `\/opt\/compose\/pdf-tools\/`/);
  assert.match(docs, /cd \/opt\/compose\/pdf-tools/);
  assert.match(agentPolicy, /must live in `\/opt\/compose\/pdf-tools\/`/);
});

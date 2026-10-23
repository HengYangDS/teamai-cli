import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LocalConfig } from '../types.js';
import { scopeScoring } from '../scorers/settings.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const ROLES = 'version: 1\nroles:\n'
  + '  - id: dev\n    resources: { knowledge: [], skills: [] }\n'
  + '  - id: ops\n    resources: { knowledge: [], skills: [], scorers: [ops] }\n'
  + '  - id: sre\n    resources: { knowledge: [], skills: [], scorers: [sre] }\n';

function teamRepo(files: Record<string, string>, member: Partial<LocalConfig> = {}): LocalConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-scoring-settings-'));
  dirs.push(root);
  const knowledge = path.join(root, 'knowledge');
  for (const [file, content] of Object.entries({ 'manifest/roles.yaml': ROLES, ...files })) {
    fs.mkdirSync(path.dirname(path.join(knowledge, file)), { recursive: true });
    fs.writeFileSync(path.join(knowledge, file), content);
  }
  return { repo: { localPath: knowledge, remote: 'local' }, username: 'tester', scope: 'project', additionalRoles: [], projectRoot: root, dataHome: path.join(root, 'data'), ...member };
}

const MACHINE = { source: 'config.yaml scoring.isolation', value: undefined };

describe('scopeScoring isolation', () => {
  it('reads the root file, and an active namespace file in its place; an inactive one is not read', async () => {
    const files = { 'scorers/scoring.yaml': 'isolation: best-effort\n', 'scorers/ops/scoring.yaml': 'isolation: verified\n' };

    expect(await scopeScoring(teamRepo(files, { primaryRole: 'dev' }))).toEqual({
      ok: true, problems: [], isolation: [{ source: 'scorers/scoring.yaml isolation', value: 'best-effort' }, MACHINE],
    });
    expect(await scopeScoring(teamRepo(files, { primaryRole: 'ops' }))).toEqual({
      ok: true, problems: [], isolation: [{ source: 'scorers/ops/scoring.yaml isolation', value: 'verified' }, MACHINE],
    });
  });

  it('keeps the isolation of every active namespace, so the strictest wins', async () => {
    const files = { 'scorers/ops/scoring.yaml': 'isolation: verified\n', 'scorers/sre/scoring.yaml': 'isolation: best-effort\n' };

    expect(await scopeScoring(teamRepo(files, { primaryRole: 'ops', additionalRoles: ['sre'] }))).toMatchObject({
      ok: true,
      isolation: [{ source: 'scorers/ops/scoring.yaml isolation', value: 'verified' }, { source: 'scorers/sre/scoring.yaml isolation', value: 'best-effort' }, MACHINE],
    });
  });

  it('fails on an active file it cannot parse, naming it, and ignores an inactive one', async () => {
    const files = { 'scorers/ops/scoring.yaml': 'isolation: [verified\n' };

    expect(await scopeScoring(teamRepo(files, { primaryRole: 'ops' }))).toEqual({
      ok: false, reason: expect.stringMatching(/^scorers\/ops\/scoring\.yaml is not valid YAML: .+\. Scoring is off in this scope until the team repo fixes it\.$/),
    });
    expect(await scopeScoring(teamRepo(files, { primaryRole: 'dev' }))).toMatchObject({ ok: true });
  });

  it('drops a key it does not know, with a problem that names the file', async () => {
    expect(await scopeScoring(teamRepo({ 'scorers/scoring.yaml': 'isolation: verified\nsampling: 50\n' }))).toMatchObject({
      ok: true, problems: ['scorers/scoring.yaml: "sampling" is not a scoring setting (isolation), so it is ignored'],
    });
  });
});


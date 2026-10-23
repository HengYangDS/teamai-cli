/**
 * The team's scoring settings, in `scorers/scoring.yaml`:
 *
 *   isolation: verified  # the least isolation every judge of the team's scorers needs
 *
 * `scorers/<ns>/scoring.yaml` is read where `<ns>` is an active scorers namespace, as model aliases are where theirs
 * is, and replaces the root key of the same name. Two active namespaces asking for an isolation give the strictest.
 *
 * A file that cannot be parsed fails the load, so no judge works to a default the team did not choose. A key or value
 * this teamai does not know is dropped with a problem instead, so a newer CLI's additions never stop this one.
 */
import path from 'node:path';
import YAML from 'yaml';
import { getKnowledgeDir, type LocalConfig } from '../types.js';
import { readEntryFileText } from '../namespaced-entries.js';
import { isSafeNamespaceSegment } from '../manifest-schema.js';
import { listDirs, pathExists } from '../utils/fs.js';
import { SCORING_FILE, scorerNamespaces } from './cache.js';
import { machineIsolation, type IsolationSetting } from './isolation.js';

/** What one `scoring.yaml` sets, or why it cannot be read; every message names the file. */
export type ScoringFileRead =
  | { ok: true; isolation?: string; problems: string[] }
  | { ok: false; reason: string };

export function parseScoringFile(relativePath: string, text: string): ScoringFileRead {
  let document: unknown;
  try {
    document = YAML.parse(text);
  } catch (error) {
    const [message = ''] = (error instanceof Error ? error.message : String(error)).split('\n');
    return { ok: false, reason: `${relativePath} is not valid YAML: ${message.replace(/:\s*$/, '')}` };
  }
  if (document === null || document === undefined) return { ok: true, problems: [] };
  if (typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, reason: `${relativePath} must be a mapping, such as \`isolation: verified\`` };
  }
  const read: ScoringFileRead & { ok: true } = { ok: true, problems: [] };
  for (const [key, value] of Object.entries(document)) {
    if (key === 'isolation') read.isolation = typeof value === 'string' ? value : JSON.stringify(value);
    else read.problems.push(`${relativePath}: "${key}" is not a scoring setting (isolation), so it is ignored`);
  }
  return read;
}

/** What scoring in this scope follows: every isolation setting that applies here. */
export type ScopeScoring =
  | { ok: true; isolation: IsolationSetting[]; problems: string[] }
  | { ok: false; reason: string };

function failed(cause: string): ScopeScoring {
  return { ok: false, reason: `${cause}. Scoring is off in this scope until the team repo fixes it.` };
}

/** The team's scoring files this member reads, with this scope's `config.yaml` `scoring.isolation`. */
export async function scopeScoring(config: LocalConfig): Promise<ScopeScoring> {
  const root = path.join(getKnowledgeDir(config), 'scorers');
  const dirs: string[] = [];
  for (const dir of (await listDirs(root)).filter(isSafeNamespaceSegment).sort()) {
    if (await pathExists(path.join(root, dir, SCORING_FILE))) dirs.push(dir);
  }
  const { active } = await scorerNamespaces(config, dirs);
  const files: Array<{ namespace: string | null; relativePath: string; isolation?: string }> = [];
  const problems: string[] = [];
  for (const namespace of [null, ...active]) {
    const relativePath = namespace === null ? `scorers/${SCORING_FILE}` : `scorers/${namespace}/${SCORING_FILE}`;
    const text = await readEntryFileText(path.join(root, ...(namespace === null ? [] : [namespace]), SCORING_FILE), relativePath);
    if (!text.ok) return failed(text.reason);
    if (text.text === null) continue;
    const read = parseScoringFile(relativePath, text.text);
    if (!read.ok) return failed(read.reason);
    problems.push(...read.problems);
    files.push({ namespace, relativePath, ...read });
  }
  const rootFile = files.find((file) => file.namespace === null);
  const inNamespaces = files.filter((file) => file.namespace !== null);

  const isolations = inNamespaces.filter((file) => file.isolation !== undefined);
  const teamIsolation = isolations.length > 0 ? isolations : rootFile?.isolation !== undefined ? [rootFile] : [];
  return {
    ok: true,
    isolation: [...teamIsolation.map((file) => ({ source: `${file.relativePath} isolation`, value: file.isolation })), machineIsolation(config)],
    problems,
  };
}

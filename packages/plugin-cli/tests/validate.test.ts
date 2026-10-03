import { afterEach, describe, expect, it } from 'vitest';
import { runValidate, validateProject } from '../src';
import { cleanupTemp, CONNECTOR_JS, manifestJson, recordingOutput, tempProject } from './helpers';

afterEach(cleanupTemp);

describe('validateProject', () => {
  it('accepts a valid built connector', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson(),
      'dist/index.js': CONNECTOR_JS,
    });
    const result = await validateProject(dir);
    expect(result.ok && result.manifest.id).toBe('com.example.test');
  });

  it('reports a missing manifest and invalid JSON', async () => {
    expect(await validateProject(tempProject())).toEqual({
      ok: false,
      errors: [expect.stringContaining('photobeaver-plugin.json not found')],
    });
    const broken = tempProject({ 'photobeaver-plugin.json': '{' });
    expect(await validateProject(broken)).toMatchObject({
      errors: [expect.stringContaining('not valid JSON')],
    });
  });

  it('reports schema errors', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson({ id: 'Bad', connector: undefined }),
    });
    const result = await validateProject(dir);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.join('\n')).toMatch(/id:.*\n.*connector/s);
  });

  it('reports an unsupported apiVersion and a missing main', async () => {
    const dir = tempProject({ 'photobeaver-plugin.json': manifestJson({ apiVersion: '9' }) });
    expect(await validateProject(dir)).toEqual({
      ok: false,
      errors: [
        'apiVersion: "9" is not supported by this version of Photo Beaver',
        'main: dist/index.js not found. Run pb-plugin build first.',
      ],
    });
  });

  it('reports a wrong export shape and exits 1', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson({
        type: 'enricher',
        enricher: { accepts: ['image/*'], input: 'metadata' },
      }),
      'dist/index.js': CONNECTOR_JS,
    });
    const out = recordingOutput();
    expect(await runValidate({ command: 'validate', dir, watch: false }, out)).toBe(1);
    expect(out.errors.join('\n')).toContain('must have a enrich() function');
  });

  it('reports a main that fails to load', async () => {
    const dir = tempProject({
      'photobeaver-plugin.json': manifestJson(),
      'dist/index.js': 'throw new Error("boom");',
    });
    expect(await validateProject(dir)).toMatchObject({ errors: [expect.stringContaining('boom')] });
  });
});

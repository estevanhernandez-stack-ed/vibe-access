import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

const load = (name) =>
  JSON.parse(readFileSync(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = {
  manifest: ajv.compile(load('manifest')),
  inventory: ajv.compile(load('inventory')),
  config: ajv.compile(load('config')),
  verifyRun: ajv.compile(load('verify-run')),
};

function run(validator, obj) {
  const valid = validator(obj);
  const errors = (validator.errors ?? []).map(
    (e) => `${e.instancePath || '/'} ${e.message}`
  );
  return { valid: !!valid, errors: valid ? [] : errors };
}

export const validateManifest = (obj) => run(compiled.manifest, obj);
export const validateInventory = (obj) => run(compiled.inventory, obj);
export const validateConfig = (obj) => run(compiled.config, obj);
export const validateVerifyRun = (obj) => run(compiled.verifyRun, obj);

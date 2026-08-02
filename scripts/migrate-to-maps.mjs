// One-time migration: world/world.json -> world/maps/overworld-default.json
// + world/maps/index.json manifest. Run once via `node scripts/migrate-to-maps.mjs`.
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OLD_PATH = path.join(ROOT, 'world/world.json');
const MAPS_DIR = path.join(ROOT, 'world/maps');
const NEW_MAP_PATH = path.join(MAPS_DIR, 'overworld-default.json');
const MANIFEST_PATH = path.join(MAPS_DIR, 'index.json');

if (existsSync(NEW_MAP_PATH)) {
  console.log('world/maps/overworld-default.json already exists — nothing to do.');
  process.exit(0);
}

const data = JSON.parse(readFileSync(OLD_PATH, 'utf-8'));
if (data.mapType === undefined) data.mapType = 'overworld';
if (data.teleporters === undefined) data.teleporters = [];

mkdirSync(MAPS_DIR, { recursive: true });
writeFileSync(NEW_MAP_PATH, JSON.stringify(data, null, 2));

const manifest = [
  { id: 'overworld-default', name: data.name, mapType: 'overworld', path: 'overworld-default.json', isDefault: true },
];
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

renameSync(OLD_PATH, OLD_PATH + '.pre-migration-backup');

console.log('Migrated world/world.json -> world/maps/overworld-default.json + world/maps/index.json');
console.log('Original file preserved as world/world.json.pre-migration-backup');

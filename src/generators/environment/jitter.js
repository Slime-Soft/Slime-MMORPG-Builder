// src/generators/environment/jitter.js
// Displace a polyhedron's vertices without tearing it open.
//
// THE BUG THIS EXISTS TO PREVENT: Three's IcosahedronGeometry / DodecahedronGeometry
// are NON-INDEXED. Every triangle carries its own copy of each corner, so a
// shared corner appears in the position buffer two or three times. Jittering the
// buffer per-VERTEX moves each copy a different way, the faces around that corner
// pull apart, and the rock ends up full of holes you can see straight through.
//
// So jitter per unique POSITION: look the original coordinate up in a map, and
// give every copy of it the identical displacement. The surface stays closed.
import * as THREE from 'three';

/**
 * @param {THREE.BufferGeometry} geo modified in place
 * @param {() => number} rng
 * @param {(rng: () => number) => {x:number,y:number,z:number}} drawScale
 *   returns a per-axis multiplier for one unique corner
 */
export function jitterSharedVertices(geo, rng, drawScale) {
  const pos = geo.attributes.position;
  const seen = new Map(); // quantized "x,y,z" -> the multiplier already drawn for it
  const key = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = key(x, y, z);
    let m = seen.get(k);
    if (!m) {
      // Draw order is stable because vertices are visited in buffer order, so
      // the same seed still yields the same rock.
      m = drawScale(rng);
      seen.set(k, m);
    }
    pos.setXYZ(i, x * m.x, y * m.y, z * m.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

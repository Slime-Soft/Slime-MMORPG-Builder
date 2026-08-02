// src/sim/shapeKinds.js
// The primitive-shape vocabulary shared by the Object Builder and the Monster
// Builder. It lives in sim because the SCHEMA validators (objectDefs.js,
// monsterTypeDefs.js) need it and sim may not import a renderer module —
// src/generators/custom.js, which builds the actual meshes, imports Three.
//
// capsule/pyramid/wedge were added for the Monster Builder's creature prefabs:
// a box/cylinder/sphere/cone-only vocabulary made organic bodies (rounded
// limbs, snouts, fins, spikes) hard to read.
//
// log-wall/shingle-roof-panel are NOT unit-sized-then-scaled like every other
// kind here — a shingled roof panel is hundreds of individual diamonds and a
// log wall is a whole row of posts, neither practical to hand-place one
// primitive at a time. Their geometry is generated directly at the shape's
// scale.x/scale.y(/scale.z) dimensions instead of being stretched from a
// template — see geometryForKind in src/generators/custom.js.
export const SHAPE_KINDS = ['box', 'cylinder', 'sphere', 'cone', 'capsule', 'pyramid', 'wedge', 'log-wall', 'shingle-roof-panel'];

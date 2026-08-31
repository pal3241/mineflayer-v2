import { NavigationError } from './navigation-error.js';

export function createNavigationMovements({ Movements, bot, policy }) {
  if (typeof Movements !== 'function') throw new NavigationError('MOVEMENTS_UNAVAILABLE', 'Pathfinder Movements constructor is unavailable', {});
  const normalizedPolicy = structuredClone(policy ?? {});

  return new class NavigationMovements extends Movements {
    constructor(client) {
      super(client);
      this.policy = normalizedPolicy;
      this.waterPolicy = structuredClone(normalizedPolicy.water ?? {});
      this.allow1by1towers = Boolean(normalizedPolicy.allow1by1towers);
      this.allowJump = Boolean(normalizedPolicy.allowJump);
      this.allowParkour = Boolean(normalizedPolicy.allowParkour);
      this.allowSprinting = Boolean(normalizedPolicy.allowSprinting);
      this.allowFreeMotion = Boolean(normalizedPolicy.allowFreeMotion);
      this.allowSwimming = Boolean(this.waterPolicy.allowSwimming);
      this.allowEnterWater = Boolean(this.waterPolicy.allowEnterWater);
      this.allowDeepWater = Boolean(this.waterPolicy.allowDeepWater);
      this.allowUnderwaterRoute = Boolean(this.waterPolicy.allowUnderwaterRoute);
      this.maxWaterDepth = Number(this.waterPolicy.maxDepth ?? 6);
      this.maxUnderwaterDurationMs = Number(this.waterPolicy.maxUnderwaterDurationMs ?? 10_000);
    }

    getMoveJumpUp(node, dir, neighbors) {
      if (!this.allowJump) return;
      return super.getMoveJumpUp(node, dir, neighbors);
    }

    getMoveParkourForward(node, dir, neighbors) {
      if (!this.allowJump) return;
      return super.getMoveParkourForward(node, dir, neighbors);
    }

    getMoveDiagonal(node, dir, neighbors) {
      if (!this.#canTraverseWater(node, dir, 0, 0)) return;
      if (this.allowJump) return super.getMoveDiagonal(node, dir, neighbors);
      const before = neighbors.length;
      super.getMoveDiagonal(node, dir, neighbors);
      trimAscendingMoves(neighbors, before, node.y);
    }

    getMoveForward(node, dir, neighbors) {
      if (!this.#canTraverseWater(node, dir, 0, 0)) return;
      return super.getMoveForward(node, dir, neighbors);
    }

    getMoveParkourForward(node, dir, neighbors) {
      const immediate = this.#canTraverseWater(node, dir, 0, 0);
      const landing = this.getBlock(node, dir.x * 2, 0, dir.z * 2);
      const landingDepth = waterDepth(this.bot, landing.position ?? node, this.maxWaterDepth);
      const landingSubmerged = isSubmerged(this.bot, landing.position ?? node);
      if (!immediate) return;
      if (isWater(landing) && !this.allowEnterWater) return;
      if (landingDepth > this.maxWaterDepth) return;
      if (isWater(landing) && !this.allowDeepWater && landingDepth > 1) return;
      if (landingSubmerged && !this.allowUnderwaterRoute) return;
      return super.getMoveParkourForward(node, dir, neighbors);
    }

    getMoveDropDown(node, dir, neighbors) {
      if (!this.#canTraverseWater(node, dir, -1, 0)) return;
      return super.getMoveDropDown(node, dir, neighbors);
    }

    getMoveDown(node, neighbors) {
      if (!this.#canTraverseWater(node, { x: 0, z: 0 }, -1, 0)) return;
      return super.getMoveDown(node, neighbors);
    }

    getMoveUp(node, neighbors) {
      if (!this.#canTraverseWater(node, { x: 0, z: 0 }, 1, 0)) return;
      return super.getMoveUp(node, neighbors);
    }

    getNeighbors(node) {
      const neighbors = [];
      for (const direction of cardinalDirections) {
        this.getMoveForward(node, direction, neighbors);
        this.getMoveJumpUp(node, direction, neighbors);
        this.getMoveDropDown(node, direction, neighbors);
        if (this.allowParkour) this.getMoveParkourForward(node, direction, neighbors);
      }
      for (const direction of diagonalDirections) this.getMoveDiagonal(node, direction, neighbors);
      this.getMoveDown(node, neighbors);
      this.getMoveUp(node, neighbors);
      return neighbors;
    }

    #canTraverseWater(node, dir, dy, dz) {
      const target = this.getBlock(node, dir.x, dy, dir.z ?? dz);
      const current = this.getBlock(node, 0, 0, 0);
      const head = this.getBlock(node, 0, 1, 0);
      const targetHead = this.getBlock(node, dir.x, dy + 1, dir.z ?? dz);
      const targetWaterDepth = waterDepth(this.bot, target.position ?? node, this.maxWaterDepth);
      const currentSubmerged = isSubmerged(this.bot, current.position ?? node);
      const targetSubmerged = isSubmerged(this.bot, target.position ?? node);
      const targetIsWater = isWater(target);

      if (currentSubmerged && !this.allowSwimming) return false;
      if (targetIsWater && !this.allowEnterWater) return false;
      if (targetWaterDepth > this.maxWaterDepth) return false;
      if (targetIsWater && !this.allowDeepWater && targetWaterDepth > 1) return false;
      if ((currentSubmerged || targetSubmerged) && !this.allowUnderwaterRoute) return false;
      return true;
    }
  }(bot);
}

const cardinalDirections = Object.freeze([
  { x: -1, z: 0 },
  { x: 1, z: 0 },
  { x: 0, z: -1 },
  { x: 0, z: 1 }
]);

const diagonalDirections = Object.freeze([
  { x: -1, z: -1 },
  { x: -1, z: 1 },
  { x: 1, z: -1 },
  { x: 1, z: 1 }
]);

function trimAscendingMoves(neighbors, before, startY) {
  const added = neighbors.splice(before);
  for (const move of added) if (move.y <= startY) neighbors.push(move);
}

function waterDepth(bot, position, maxDepth) {
  if (!bot?.blockAt || !position) return 0;
  let depth = 0;
  let cursor = position.floored ? position.floored() : position;
  while (depth < maxDepth) {
    const block = bot.blockAt(cursor);
    if (!isWater(block)) break;
    depth++;
    cursor = cursor.offset ? cursor.offset(0, -1, 0) : { x: cursor.x, y: cursor.y - 1, z: cursor.z };
  }
  return depth;
}

function isSubmerged(bot, position) {
  if (!bot?.blockAt || !position) return false;
  const feet = position.floored ? position.floored() : position;
  const head = feet.offset ? feet.offset(0, 1, 0) : { x: feet.x, y: feet.y + 1, z: feet.z };
  return isWater(bot.blockAt(feet)) && isWater(bot.blockAt(head));
}

function isWater(block) {
  return ['water', 'bubble_column'].includes(String(block?.name ?? ''));
}

function isWaterAbove(block) {
  return Boolean(block?.liquid ?? ['water', 'bubble_column'].includes(String(block?.name ?? '')));
}

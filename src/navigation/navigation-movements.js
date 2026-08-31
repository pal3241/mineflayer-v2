import { NavigationError } from './navigation-error.js';

export function createNavigationMovements({ Movements, bot, policy }) {
  if (typeof Movements !== 'function') throw new NavigationError('MOVEMENTS_UNAVAILABLE', 'Pathfinder Movements constructor is unavailable', {});
  const normalizedPolicy = structuredClone(policy ?? {});

  return new class NavigationMovements extends Movements {
    constructor(client) {
      super(client);
      this.policy = normalizedPolicy;
      this.waterPolicy = structuredClone(normalizedPolicy.water ?? {});
      this.allowJump = Boolean(normalizedPolicy.allowJump);
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
      if (this.allowJump) return super.getMoveDiagonal(node, dir, neighbors);
      const before = neighbors.length;
      super.getMoveDiagonal(node, dir, neighbors);
      trimAscendingMoves(neighbors, before, node.y);
    }

    getMoveForward(node, dir, neighbors) {
      if (!this.#canTraverseWater(node, dir, 0, 0)) return;
      return super.getMoveForward(node, dir, neighbors);
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
      const policy = this.waterPolicy;
      const target = this.getBlock(node, dir.x, dy, dir.z ?? dz);
      const current = this.getBlock(node, 0, 0, 0);
      const head = this.getBlock(node, 0, 1, 0);
      const targetHead = this.getBlock(node, dir.x, dy + 1, dir.z ?? dz);
      const depth = waterDepth(this.bot, target.position ?? node, this.maxWaterDepth);
      const underwater = isUnderwater(current) || isUnderwater(head) || isUnderwater(target) || isUnderwater(targetHead);

      if ((isUnderwater(current) || isUnderwater(head)) && !this.allowSwimming) return false;
      if (isUnderwater(target) && !this.allowEnterWater) return false;
      if (depth > this.maxWaterDepth) return false;
      if (!this.allowDeepWater && depth > 1) return false;
      if (underwater && !this.allowUnderwaterRoute) return false;
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

function isUnderwater(block) {
  return isWater(block) && isWaterAbove(block);
}

function isWater(block) {
  return ['water', 'bubble_column'].includes(String(block?.name ?? ''));
}

function isWaterAbove(block) {
  return Boolean(block?.liquid ?? ['water', 'bubble_column'].includes(String(block?.name ?? '')));
}

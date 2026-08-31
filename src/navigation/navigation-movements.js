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

    getMoveDiagonal(node, dir, neighbors) {
      if (!this.#canTraverseRoute(node, dir, 0, 0, { allowJump: this.allowJump, allowParkour: this.allowParkour })) return;
      if (this.allowJump) return super.getMoveDiagonal(node, dir, neighbors);
      const before = neighbors.length;
      super.getMoveDiagonal(node, dir, neighbors);
      trimAscendingMoves(neighbors, before, node.y);
    }

    getMoveForward(node, dir, neighbors) {
      if (!this.#canTraverseRoute(node, dir, 0, 0, { allowSwimming: this.allowSwimming, allowEnterWater: this.allowEnterWater, allowDeepWater: this.allowDeepWater, allowUnderwaterRoute: this.allowUnderwaterRoute })) return;
      return super.getMoveForward(node, dir, neighbors);
    }

    getMoveJumpUp(node, dir, neighbors) {
      if (!this.allowJump) return;
      if (!this.#canTraverseRoute(node, dir, 1, 0, { allowJump: this.allowJump, allowParkour: this.allowParkour })) return;
      return super.getMoveJumpUp(node, dir, neighbors);
    }

    getMoveDropDown(node, dir, neighbors) {
      if (!this.#canTraverseRoute(node, dir, -1, 0, { allowSwimming: this.allowSwimming, allowEnterWater: this.allowEnterWater, allowDeepWater: this.allowDeepWater, allowUnderwaterRoute: this.allowUnderwaterRoute })) return;
      return super.getMoveDropDown(node, dir, neighbors);
    }

    getMoveDown(node, neighbors) {
      if (!this.#canTraverseRoute(node, { x: 0, z: 0 }, -1, 0, { allowSwimming: this.allowSwimming, allowEnterWater: this.allowEnterWater, allowDeepWater: this.allowDeepWater, allowUnderwaterRoute: this.allowUnderwaterRoute })) return;
      return super.getMoveDown(node, neighbors);
    }

    getMoveUp(node, neighbors) {
      if (!this.#canTraverseRoute(node, { x: 0, z: 0 }, 1, 0, { allowSwimming: this.allowSwimming, allowEnterWater: this.allowEnterWater, allowDeepWater: this.allowDeepWater, allowUnderwaterRoute: this.allowUnderwaterRoute })) return;
      return super.getMoveUp(node, neighbors);
    }

    getMoveParkourForward(node, dir, neighbors) {
      if (!this.allowParkour || !this.allowJump) return;
      if (!this.#canTraverseRoute(node, dir, 0, 0, { allowSwimming: this.allowSwimming, allowEnterWater: this.allowEnterWater, allowDeepWater: this.allowDeepWater, allowUnderwaterRoute: this.allowUnderwaterRoute, parkour: true })) return;
      return super.getMoveParkourForward(node, dir, neighbors);
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

    #canTraverseRoute(node, dir, dy, dz, options) {
      const target = this.getBlock(node, dir.x, dy, dir.z ?? dz);
      const current = this.getBlock(node, 0, 0, 0);
      const head = this.getBlock(node, 0, 1, 0);
      const targetHead = this.getBlock(node, dir.x, dy + 1, dir.z ?? dz);
      const targetWaterDepth = waterDepth(this.bot, target.position ?? node, this.maxWaterDepth);
      const currentSubmerged = isSubmerged(this.bot, current.position ?? node);
      const targetSubmerged = isSubmerged(this.bot, target.position ?? node);
      const targetIsWater = isWater(target);
      const targetIsOpenWater = targetIsWater && targetWaterDepth >= 1;

      if ((currentSubmerged || isWater(head)) && !options.allowSwimming) return false;
      if (targetIsWater && !options.allowEnterWater) return false;
      if (targetWaterDepth > this.maxWaterDepth) return false;
      if (targetIsOpenWater && !options.allowDeepWater && targetWaterDepth > 1) return false;
      if ((currentSubmerged || targetSubmerged) && !options.allowUnderwaterRoute) return false;
      if (options.parkour && (currentSubmerged || targetSubmerged || isWater(targetHead))) return false;
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
  while (depth <= maxDepth) {
    const block = bot.blockAt(cursor);
    if (!isWater(block)) break;
    depth++;
    if (depth > maxDepth) return depth;
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

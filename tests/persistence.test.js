import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonRepository } from '../src/index.js';

test('JSON repository implements CRUD safely', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'minehive-'));
  try {
    const repository = new JsonRepository(join(directory, 'records.json'));
    await repository.create({ id: 'one', value: 1 }); assert.equal((await repository.find('one')).value, 1);
    await repository.update('one', { value: 2 }); assert.equal((await repository.list())[0].value, 2);
    assert.equal(await repository.delete('one'), true); assert.deepEqual(await repository.list(), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

export function createEnvironmentObserver({ model, logger, intervalMs = 15_000, minimumDistance = 16 }) {
  const observers = new Map(); let observations = 0;
  const attach = runtime => { if (!runtime.adapter?.environmentSnapshot) return () => {}; let last = null, lastAt = 0, timer = null, running = false;
    const sample = async () => { const snapshot = runtime.adapter.snapshot(); if (!snapshot.position || running || (last && distance(last, snapshot.position) < minimumDistance && Date.now() - lastAt < intervalMs)) return; running = true; try { const environment = await runtime.adapter.environmentSnapshot(); const scope = { worldKey:`${String(runtime.options?.host ?? 'localhost').toLowerCase()}:${Number(runtime.options?.port ?? 25565)}`, dimension:String(snapshot.dimension ?? 'overworld') }; await model.observe({ ...scope, position:snapshot.position, features:environment.features, source:'movement-observer' }); last = snapshot.position; lastAt = Date.now(); observations++; } finally { running = false; } };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => sample().catch(error => logger?.warn?.('environment.observer.failed',{ botId:runtime.bot?.id ?? runtime.id,error:error.message })),250); timer.unref?.(); };
    const id = runtime.bot?.id ?? runtime.id; const ended = () => clearTimeout(timer); runtime.adapter.on('spawn',schedule); runtime.adapter.on('move',schedule); runtime.adapter.on('end',ended); const detach = () => { clearTimeout(timer); runtime.adapter.off('spawn',schedule); runtime.adapter.off('move',schedule); runtime.adapter.off('end',ended); observers.delete(id); }; observers.set(id,detach); return detach;
  };
  const stop = () => { for (const detach of observers.values()) detach(); observers.clear(); };
  return Object.freeze({ attach, stop, status:() => ({ status:'HEALTHY', observers:observers.size, observations, intervalMs, minimumDistance }) });
}
function distance(a,b) { return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z); }

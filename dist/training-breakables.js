const containerName = /^d_(bbbox|bbox|box|rjug|jug)(\d+)$/i;
const dropName = /^d_(it|wp)(bbbox|bbox|box|rjug|jug)(\d+)$/i;

// Training has no mission VM. Bind the level's placed pickups to their own
// containers and let practice attacks open them.
export class TrainingBreakables {
  constructor(instances, { random = Math.random } = {}) {
    this.random = random;
    this.containers = new Map();
    const byName = new Map();
    for (const instance of instances?.values() || []) {
      const source = containerName.exec(instance.name);
      if (!source || !instance.colliders?.length || Number(instance.attributes.active) === 0) continue;
      const kind = source[1].toLowerCase();
      const jar = kind.endsWith('jug');
      const record = { jar, hp: jar ? 35 : 80, loot: new Map(), broken: false };
      this.containers.set(instance, record);
      byName.set(kind + Number(source[2]), record);
    }
    for (const instance of instances?.values() || []) {
      const source = dropName.exec(instance.name);
      if (!source) continue;
      const kind = source[2].toLowerCase(), numbered = source[3];
      const randomized = kind === 'rjug';
      const variant = randomized ? numbered.slice(-2) : '';
      const indexed = randomized ? numbered.slice(0, -2) : numbered;
      const record = byName.get(kind + Number(indexed));
      if (!record) continue;
      if (!record.loot.has(variant)) record.loot.set(variant, []);
      record.loot.get(variant).push(instance);
      instance.setActive(false);
      instance.setCollision(false);
      instance.attributes.interactive = 0;
    }
  }

  canHit(instance) {
    const record = this.containers.get(instance);
    return !!record && !record.broken && Number(instance.attributes.active) !== 0 && Number(instance.attributes.interactive) !== 0;
  }

  hit(instance, damage) {
    if (!this.canHit(instance) || !(damage > 0)) return null;
    const record = this.containers.get(instance);
    record.hp -= damage;
    if (record.hp > 0) return { sound: record.jar ? 'WonHIT' : 'BoxHIT', broken: false };
    record.broken = true;
    instance.attributes.interactive = 0;
    instance.setCollision(false);
    if (!instance.playPose(1) || !instance.playing) instance.setActive(false);
    const available = [...record.loot.values()];
    const chosen = available.length > 1 ? Math.min(available.length - 1, Math.floor(this.random() * available.length)) : 0;
    const drops = available[chosen] || [];
    for (const drop of drops) {
      drop.setActive(true);
      drop.setCollision(false);
      drop.attributes.interactive = 1;
    }
    return { sound: record.jar ? 'WonBRK' : 'BoxBRK', broken: true, drops: drops.map(drop => drop.name) };
  }

  update() {
    for (const [instance, record] of this.containers) {
      if (record.broken && !instance.playing && Number(instance.attributes.active) !== 0) instance.setActive(false);
    }
  }
}

import * as THREE from './vendor/three.module.js';
import { loadGmb } from './gmc-loader.js';

const root = new URL('./assets/weapon-skins/glow/', import.meta.url);
const atlases = ['js.ifl', 'sj.ifl'];
const frameCount = 10;
const framesPerSecond = 30;
const textureFiles = {
  'js.ifl': 'js-glow.webp',
  'sj.ifl': 'sj-glow.webp',
  'sj4.tga': 'sj4.webp',
  'sj6.tga': 'sj6.webp'
};

const gripAttachments = {
  'glow-w9_0r': {
    d_wpnrs: { position: [0, -.40521, 0] },
    d_wpnre: { position: [0, -25.0325, 0] }
  },
  // The supplied sheath DES omits trail sockets. Use the sheath's centerline
  // and the end of its mesh to seat this skin's longer blade.
  'glow-w9_0l': {
    d_wpnls: { position: [0, 24.65, 0] },
    d_wpnle: { position: [0, 22.85, 0] }
  }
};

function setAtlasFrame(texture, frame) {
  const halfTexel = .5 / texture.image.width;
  texture.offset.x = frame / frameCount + halfTexel;
}

export class GlowWeaponAssets {
  async _loadTextures() {
    const loader = new THREE.TextureLoader();
    const results = await Promise.allSettled(Object.entries(textureFiles).map(async ([name, file]) => {
      const texture = await loader.loadAsync(new URL(`textures/${file}`, root).href);
      texture.colorSpace = THREE.SRGBColorSpace;
      if (atlases.includes(name)) {
        texture.generateMipmaps = false;
        texture.minFilter = THREE.LinearFilter;
        texture.repeat.x = 1 / frameCount - 1 / texture.image.width;
        setAtlasFrame(texture, 0);
      } else {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = 4;
      }
      return [name, texture];
    }));
    const failure = results.find(entry => entry.status === 'rejected');
    if (failure || this.disposed) {
      for (const entry of results) if (entry.status === 'fulfilled') entry.value[1].dispose();
      throw failure?.reason ?? new Error('Glow weapon assets disposed');
    }
    return this.textures = Object.fromEntries(results.map(entry => entry.value));
  }

  async load(modelId) {
    this.loading ||= this._loadTextures().catch(error => {
      this.loading = null;
      throw error;
    });
    const textureOverrides = await this.loading;
    const model = await loadGmb(new URL(`models/${modelId}.gmb`, root).href, {
      name: modelId, source: `weapon-skins/glow/${modelId}`,
      scale: 1, groundZ: 0, unlit: true, skipEffects: false,
      textureOverrides, additiveTextures: atlases
    });
    if (gripAttachments[modelId]) model.userData.qiankunGripAttachments = gripAttachments[modelId];
    return model;
  }

  update(time) {
    if (!this.textures) return;
    const frame = Math.floor(time * framesPerSecond) % frameCount;
    if (frame === this.frame) return;
    for (const name of atlases) setAtlasFrame(this.textures[name], frame);
    this.frame = frame;
  }

  dispose() {
    this.disposed = true;
    for (const texture of Object.values(this.textures || {})) texture.dispose();
    this.textures = null;
  }
}
